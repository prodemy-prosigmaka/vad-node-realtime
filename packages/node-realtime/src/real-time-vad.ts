import fs from "node:fs/promises";
import * as ortInstance from "onnxruntime-node";
import {
	FrameProcessor,
	type FrameProcessorEvent,
	type FrameProcessorOptions,
	defaultLegacyFrameProcessorOptions,
	defaultV5FrameProcessorOptions,
	validateOptions,
} from "./frame-processor";
import { log } from "./logging";
import { Message } from "./messages";
import {
	type Model,
	type ModelFactory,
	type OrtOptions,
	SileroLegacy,
	SileroV5,
	type SpeechProbabilities,
} from "./models";
import { Resampler } from "./resampler";

export const DEFAULT_MODEL = "legacy";

interface RealTimeVADCallbacks {
	/** Callback to run after each frame. The size (number of samples) of a frame is given by `frameSamples`. */
	onFrameProcessed: (
		probabilities: SpeechProbabilities,
		frame: Float32Array,
	) => any;

	/** Callback to run if speech start was detected but `onSpeechEnd` will not be run because the
	 * audio segment is smaller than `minSpeechFrames`.
	 */
	onVADMisfire: () => any;

	/** Callback to run when speech start is detected */
	onSpeechStart: () => any;

	/**
	 * Callback to run when speech end is detected.
	 * Takes as arg a Float32Array of audio samples between -1 and 1, sample rate 16000.
	 * This will not run if the audio segment is smaller than `minSpeechFrames`.
	 */
	onSpeechEnd: (audio: Float32Array) => any;

	/** Callback to run when speech is detected as valid. (i.e. not a misfire) */
	onSpeechRealStart: () => any;
}

/**
 * Customizable audio constraints for the VAD.
 * Excludes certain constraints that are set for the user by default.
 */
type AudioConstraints = Omit<
	MediaTrackConstraints,
	"channelCount" | "echoCancellation" | "autoGainControl" | "noiseSuppression"
>;

type AssetOptions = {
	_?: never;
};

type ModelOptions = {
	model: "v5" | "legacy";
};

interface RealTimeVADOptionsWithoutStream
	extends FrameProcessorOptions,
		RealTimeVADCallbacks,
		OrtOptions,
		AssetOptions,
		ModelOptions {
	additionalAudioConstraints?: AudioConstraints;
	stream: undefined;
}

interface RealTimeVADOptionsWithStream
	extends FrameProcessorOptions,
		RealTimeVADCallbacks,
		OrtOptions,
		AssetOptions,
		ModelOptions {
	stream: MediaStream;
}

export const ort = ortInstance;

export type RealTimeVADOptions =
	| RealTimeVADOptionsWithStream
	| RealTimeVADOptionsWithoutStream;

const sileroV5File = "silero_vad_v5.onnx";
const sileroLegacyFile = "silero_vad_legacy.onnx";

export const getDefaultRealTimeVADOptions: (
	model: "v5" | "legacy",
) => RealTimeVADOptions = (model) => {
	const frameProcessorOptions =
		model === "v5"
			? defaultV5FrameProcessorOptions
			: defaultLegacyFrameProcessorOptions;
	return {
		...frameProcessorOptions,
		onFrameProcessed: (probabilities, frame) => {},
		onVADMisfire: () => {
			log.debug("VAD misfire");
		},
		onSpeechStart: () => {
			log.debug("Detected speech start");
		},
		onSpeechEnd: () => {
			log.debug("Detected speech end");
		},
		onSpeechRealStart: () => {
			log.debug("Detected real speech start");
		},
		stream: undefined,
		ortConfig: undefined,
		model: DEFAULT_MODEL,
	};
};

export class MicVAD {
	static async new(options: Partial<RealTimeVADOptions> = {}) {
		const fullOptions: RealTimeVADOptions = {
			...getDefaultRealTimeVADOptions(options.model ?? DEFAULT_MODEL),
			...options,
		};
		validateOptions(fullOptions);

		let stream: MediaStream;
		if (fullOptions.stream === undefined)
			stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					...fullOptions.additionalAudioConstraints,
					channelCount: 1,
					echoCancellation: true,
					autoGainControl: true,
					noiseSuppression: true,
				},
			});
		else stream = fullOptions.stream;

		const audioContext = new AudioContext();
		const sourceNode = new MediaStreamAudioSourceNode(audioContext, {
			mediaStream: stream,
		});

		const audioNodeVAD = await AudioNodeVAD.new(audioContext, fullOptions);
		audioNodeVAD.receive(sourceNode);

		return new MicVAD(
			fullOptions,
			audioContext,
			stream,
			audioNodeVAD,
			sourceNode,
		);
	}

	private constructor(
		public options: RealTimeVADOptions,
		private audioContext: AudioContext,
		private stream: MediaStream,
		private audioNodeVAD: AudioNodeVAD,
		private sourceNode: MediaStreamAudioSourceNode,
		private listening = false,
	) {}

	pause = () => {
		this.audioNodeVAD.pause();
		this.listening = false;
	};

	start = () => {
		this.audioNodeVAD.start();
		this.listening = true;
	};

	destroy = () => {
		if (this.listening) {
			this.pause();
		}
		if (this.options.stream === undefined) {
			// biome-ignore lint/complexity/noForEach: <explanation>
			this.stream.getTracks().forEach((track) => track.stop());
		}
		this.sourceNode.disconnect();
		this.audioNodeVAD.destroy();
		this.audioContext.close();
	};

	setOptions = (options) => {
		this.audioNodeVAD.setFrameProcessorOptions(options);
	};
}

export class AudioNodeVAD {
	private audioNode!: ScriptProcessorNode;
	private frameProcessor: FrameProcessor;
	private gainNode?: GainNode;
	private resampler?: Resampler;

	static async new(
		ctx: AudioContext,
		options: Partial<RealTimeVADOptions> = {},
	) {
		const fullOptions: RealTimeVADOptions = {
			...getDefaultRealTimeVADOptions(options.model ?? DEFAULT_MODEL),
			...options,
		} as RealTimeVADOptions;
		validateOptions(fullOptions);

		if (fullOptions.ortConfig !== undefined) {
			fullOptions.ortConfig(ort);
		}

		const modelFile = `${__dirname}/${fullOptions.model === "v5" ? sileroV5File : sileroLegacyFile}`;
		const modelFetcher = async (): Promise<ArrayBuffer> => {
			const contents = await fs.readFile(modelFile);
			return contents.buffer;
		};
		const modelFactory: ModelFactory =
			fullOptions.model === "v5" ? SileroV5.new : SileroLegacy.new;
		let model: Model;
		try {
			model = await modelFactory(ort, modelFetcher);
		} catch (e) {
			console.error(
				`Encountered an error while loading model file ${modelFile}`,
			);
			throw e;
		}

		const frameProcessor = new FrameProcessor(
			model.process,
			model.reset_state,
			{
				frameSamples: fullOptions.frameSamples,
				positiveSpeechThreshold: fullOptions.positiveSpeechThreshold,
				negativeSpeechThreshold: fullOptions.negativeSpeechThreshold,
				redemptionFrames: fullOptions.redemptionFrames,
				preSpeechPadFrames: fullOptions.preSpeechPadFrames,
				minSpeechFrames: fullOptions.minSpeechFrames,
				submitUserSpeechOnPause: fullOptions.submitUserSpeechOnPause,
			},
		);

		const audioNodeVAD = new AudioNodeVAD(ctx, fullOptions, frameProcessor);
		await audioNodeVAD.setupAudioNode();
		return audioNodeVAD;
	}

	constructor(
		public ctx: AudioContext,
		public options: RealTimeVADOptions,
		frameProcessor: FrameProcessor,
	) {
		this.frameProcessor = frameProcessor;
	}

	private async setupAudioNode() {
		// Initialize resampler for ScriptProcessor
		this.resampler = new Resampler({
			nativeSampleRate: this.ctx.sampleRate,
			targetSampleRate: 16000, // VAD models expect 16kHz
			targetFrameSize: this.options.frameSamples ?? 480,
		});

		// Fallback to ScriptProcessor
		const bufferSize = 4096; // Increased for more stable processing
		this.audioNode = this.ctx.createScriptProcessor(bufferSize, 1, 1);

		// Create a gain node with zero gain to handle the audio chain
		this.gainNode = this.ctx.createGain();
		this.gainNode.gain.value = 0;

		let processingAudio = false;
		(this.audioNode as ScriptProcessorNode).onaudioprocess = async (
			e: AudioProcessingEvent,
		) => {
			if (processingAudio) return;
			processingAudio = true;

			try {
				const input = e.inputBuffer.getChannelData(0);
				const output = e.outputBuffer.getChannelData(0);
				output.fill(0);

				// Process through resampler
				if (this.resampler) {
					const frames = this.resampler.process(input);
					for (const frame of frames) {
						await this.processFrame(frame);
					}
				}
			} catch (error) {
				console.error("Error processing audio:", error);
			} finally {
				processingAudio = false;
			}
		};

		// Connect the audio chain
		this.audioNode.connect(this.gainNode);
		this.gainNode.connect(this.ctx.destination);
	}

	pause = () => {
		this.frameProcessor.pause(this.handleFrameProcessorEvent);
	};

	start = () => {
		this.frameProcessor.resume();
	};

	receive = (node: AudioNode) => {
		node.connect(this.audioNode);
	};

	processFrame = async (frame: Float32Array) => {
		await this.frameProcessor.process(frame, this.handleFrameProcessorEvent);
	};

	handleFrameProcessorEvent = (ev: FrameProcessorEvent) => {
		switch (ev.msg) {
			case Message.FrameProcessed:
				this.options.onFrameProcessed(ev.probs, ev.frame as Float32Array);
				break;

			case Message.SpeechStart:
				this.options.onSpeechStart();
				break;

			case Message.SpeechRealStart:
				this.options.onSpeechRealStart();
				break;

			case Message.VADMisfire:
				this.options.onVADMisfire();
				break;

			case Message.SpeechEnd:
				this.options.onSpeechEnd(ev.audio as Float32Array);
				break;
		}
	};

	destroy = () => {
		if (this.audioNode instanceof AudioWorkletNode) {
			this.audioNode.port.postMessage({
				message: Message.SpeechStop,
			});
		}
		this.audioNode.disconnect();
		this.gainNode?.disconnect();
	};

	setFrameProcessorOptions = (options) => {
		this.frameProcessor.options = {
			...this.frameProcessor.options,
			...options,
		};
	};
}
