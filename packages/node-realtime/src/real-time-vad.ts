import {
	FrameProcessor,
	type FrameProcessorOptions,
	Message,
	type ONNXRuntimeAPI,
	type OrtOptions,
	Resampler,
	Silero,
	type SpeechProbabilities,
	defaultFrameProcessorOptions,
	log,
	validateOptions,
} from "./common";

interface RealTimeVADCallbacks {
	/** Callback to run after each frame. The size (number of samples) of a frame is given by `frameSamples`. */
	onFrameProcessed: (
		probabilities: SpeechProbabilities,
		frame: Float32Array,
	) => void;

	/** Callback to run if speech start was detected but `onSpeechEnd` will not be run because the
	 * audio segment is smaller than `minSpeechFrames`.
	 */
	onVADMisfire: () => void;

	/** Callback to run when speech start is detected */
	onSpeechStart: () => void;

	/**
	 * Callback to run when speech end is detected.
	 * Takes as arg a Float32Array of audio samples between -1 and 1, sample rate 16000.
	 * This will not run if the audio segment is smaller than `minSpeechFrames`.
	 */
	onSpeechEnd: (audio: Float32Array) => void;
}

export interface RealTimeVADOptions
	extends FrameProcessorOptions,
		RealTimeVADCallbacks,
		OrtOptions {
	/** Sample rate of the input audio (will be resampled to 16000Hz internally) */
	sampleRate: number;
}

export const defaultRealTimeVADOptions: RealTimeVADOptions = {
	...defaultFrameProcessorOptions,
	onFrameProcessed: () => {},
	onVADMisfire: () => {
		log.debug("VAD misfire");
	},
	onSpeechStart: () => {
		log.debug("Detected speech start");
	},
	onSpeechEnd: () => {
		log.debug("Detected speech end");
	},
	ortConfig: undefined,
	sampleRate: 16000,
};

export class RealTimeVAD {
	private frameProcessor: FrameProcessor;
	private model: Silero;
	private buffer: Float32Array = new Float32Array(0);
	private frameSamples: number;
	private active = false;
	private resampler: Resampler | null = null;

	/**
	 * Create a new RealTimeVAD instance with external ONNX runtime and model fetcher
	 */
	static async new(
		ort: ONNXRuntimeAPI,
		modelFetcher: () => Promise<ArrayBuffer>,
		options: Partial<RealTimeVADOptions> = {},
	): Promise<RealTimeVAD> {
		const fullOptions: RealTimeVADOptions = {
			...defaultRealTimeVADOptions,
			...options,
		};
		validateOptions(fullOptions);

		if (fullOptions.ortConfig !== undefined) {
			fullOptions.ortConfig(ort);
		}

		const model = await Silero.new(ort, modelFetcher);
		const realTimeVAD = new RealTimeVAD(fullOptions, model);
		return realTimeVAD;
	}

	/**
	 * Create a new RealTimeVAD instance with provided model fetcher and ONNX runtime
	 */
	static async _new(
		modelFetcher: () => Promise<ArrayBuffer>,
		ort: ONNXRuntimeAPI,
		options: Partial<RealTimeVADOptions> = {},
	): Promise<RealTimeVAD> {
		return await RealTimeVAD.new(ort, modelFetcher, options);
	}

	constructor(
		public options: RealTimeVADOptions,
		model: Silero,
	) {
		this.model = model;
		this.frameSamples = options.frameSamples;
		this.frameProcessor = new FrameProcessor(model.process, model.reset_state, {
			frameSamples: options.frameSamples,
			positiveSpeechThreshold: options.positiveSpeechThreshold,
			negativeSpeechThreshold: options.negativeSpeechThreshold,
			redemptionFrames: options.redemptionFrames,
			preSpeechPadFrames: options.preSpeechPadFrames,
			minSpeechFrames: options.minSpeechFrames,
			submitUserSpeechOnPause: options.submitUserSpeechOnPause,
		});

		// If input sample rate is not 16000, create a resampler
		if (options.sampleRate !== 16000) {
			this.resampler = new Resampler({
				nativeSampleRate: options.sampleRate,
				targetSampleRate: 16000,
				targetFrameSize: this.frameSamples,
			});
		}
	}

	/**
	 * Start processing audio
	 */
	start(): void {
		this.active = true;
		this.frameProcessor.resume();
	}

	/**
	 * Pause processing audio
	 */
	pause(): void {
		this.active = false;
		const result = this.frameProcessor.pause();
		this.handleFrameProcessorEvent(result);
	}

	/**
	 * Feed audio data to the VAD
	 * @param audioData Audio data with sample rate matching the sampleRate option
	 */
	async processAudio(audioData: Float32Array): Promise<void> {
		if (!this.active) return;

		// If resampling is needed, convert the input audio to 16kHz
		let processedAudio: Float32Array;
		if (this.resampler) {
			// Process audio through resampler and collect all chunks
			const chunks: Float32Array[] = [];
			for await (const chunk of this.resampler.stream(audioData)) {
				chunks.push(chunk);
			}

			// Combine chunks into a single array
			const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
			processedAudio = new Float32Array(totalLength);
			let offset = 0;
			for (const chunk of chunks) {
				processedAudio.set(chunk, offset);
				offset += chunk.length;
			}
		} else {
			processedAudio = audioData;
		}

		// Append new audio data to existing buffer
		const newBuffer = new Float32Array(
			this.buffer.length + processedAudio.length,
		);
		newBuffer.set(this.buffer);
		newBuffer.set(processedAudio, this.buffer.length);
		this.buffer = newBuffer;

		// Process as many complete frames as possible
		while (this.buffer.length >= this.frameSamples) {
			const frame = this.buffer.slice(0, this.frameSamples);
			this.buffer = this.buffer.slice(this.frameSamples);

			// Process the frame
			const result = await this.frameProcessor.process(frame);
			this.handleFrameProcessorEvent(result);
		}
	}

	/**
	 * Process any remaining audio in the buffer and reset
	 */
	async flush(): Promise<void> {
		// If there's data in the buffer but not enough for a frame, pad with zeros
		if (this.buffer.length > 0 && this.buffer.length < this.frameSamples) {
			const paddedFrame = new Float32Array(this.frameSamples);
			paddedFrame.set(this.buffer);
			const result = await this.frameProcessor.process(paddedFrame);
			this.handleFrameProcessorEvent(result);
		}

		// End the current segment
		const result = this.frameProcessor.endSegment();
		this.handleFrameProcessorEvent(result);

		// Reset buffer
		this.buffer = new Float32Array(0);
	}

	/**
	 * Reset the VAD state
	 */
	reset(): void {
		this.buffer = new Float32Array(0);
		this.model.reset_state();
	}

	/**
	 * Handle events from the frame processor
	 */
	private handleFrameProcessorEvent(
		ev: Partial<{
			probs: SpeechProbabilities;
			msg: Message;
			audio: Float32Array;
			frame: Float32Array;
		}>,
	): void {
		if (ev.probs !== undefined && ev.frame !== undefined) {
			this.options.onFrameProcessed(ev.probs, ev.frame);
		}

		switch (ev.msg) {
			case Message.SpeechStart:
				this.options.onSpeechStart();
				break;

			case Message.VADMisfire:
				this.options.onVADMisfire();
				break;

			case Message.SpeechEnd:
				if (ev.audio) {
					this.options.onSpeechEnd(ev.audio);
				}
				break;

			default:
				break;
		}
	}

	/**
	 * Clean up resources
	 */
	destroy(): void {
		this.pause();
		this.reset();
	}
}
