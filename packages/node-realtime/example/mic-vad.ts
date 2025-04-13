import * as fs from "node:fs";
import * as path from "node:path";
import type { Readable } from "node:stream";
import { AudioNodeVAD, getDefaultRealTimeVADOptions, utils } from "../dist";

// For this example to work, you'll need to install:
// npm install mic

// First, make sure you have the necessary audio tools on your system:
// On macOS: brew install sox
// On Ubuntu/Debian: sudo apt-get install sox libsox-fmt-all

// Define the mic module interface to avoid TypeScript errors
interface MicOptions {
	rate?: string;
	channels?: string;
	debug?: boolean;
	fileType?: string;
	exitOnSilence?: number;
	device?: string;
}

interface MicInstance {
	start: () => void;
	stop: () => void;
	pause: () => void;
	resume: () => void;
	getAudioStream: () => Readable;
}

type MicModule = (options: MicOptions) => MicInstance;

async function main() {
	console.log("Starting microphone VAD example...");
	console.log("This will use your computer's microphone to detect speech");
	console.log("Press Ctrl+C to stop recording");

	// Import the mic package using require (with type assertion)
	const mic = require("mic") as MicModule;

	// Configure the microphone
	const micInstance = mic({
		rate: "16000",
		channels: "1",
		debug: false,
		fileType: "raw",
	});

	// Create a simple audio context for the VAD
	const audioContext = new globalThis.AudioContext({
		sampleRate: 16000, // Use a fixed sample rate matching what the VAD expects
	});

	// Get default VAD options
	const vadOptions = getDefaultRealTimeVADOptions("legacy");

	// Adjust thresholds for better detection
	vadOptions.positiveSpeechThreshold = 0.3;
	vadOptions.negativeSpeechThreshold = 0.2;

	// Initialize the VAD
	console.log("Creating AudioNodeVAD...");
	console.log(
		`Speech detection threshold: ${vadOptions.positiveSpeechThreshold}`,
	);

	const vad = await AudioNodeVAD.new(audioContext, {
		...vadOptions,
		// Reduce pre-speech padding to avoid long silence at the beginning
		preSpeechPadFrames: 5,
		// Reduce redemption frames to avoid long silence at the end
		redemptionFrames: 8,
		onSpeechStart: () => console.log("\n🎤 Speech detected! Speaking..."),
		onSpeechEnd: (audio: Float32Array) => {
			// Trim silence from the beginning and end of the recording
			const trimmedAudio = trimSilence(audio, 0.01);

			// Upsample the audio to 44.1kHz for better playback compatibility
			const OUTPUT_SAMPLE_RATE = 44100;
			const upsampledAudio = upsampleAudio(
				trimmedAudio,
				16000,
				OUTPUT_SAMPLE_RATE,
			);

			// Save the detected speech segment
			const timestamp = Date.now();
			const outputPath = path.resolve(
				__dirname,
				`../mic_speech_${timestamp}.wav`,
			);

			// Save as 16-bit PCM WAV with 44.1kHz sample rate for better compatibility
			const wavBuffer = utils.encodeWAV(upsampledAudio, 1, OUTPUT_SAMPLE_RATE);
			fs.writeFileSync(outputPath, Buffer.from(wavBuffer));
			console.log(
				`✅ Speech ended - saved to ${outputPath} (${(trimmedAudio.length / 16000).toFixed(2)}s)`,
			);

			// Display audio stats
			const nonZeroSamples = trimmedAudio.filter((val) => val !== 0).length;
			console.log(
				`Audio stats: ${trimmedAudio.length} samples, ${nonZeroSamples} non-zero (${Math.round((nonZeroSamples / trimmedAudio.length) * 100)}%)`,
			);
		},
		onVADMisfire: () => {
			console.log("🔇 (False alarm - too short)");
		},
	});

	// Start the VAD
	vad.start();

	// Start the microphone
	const micInputStream = micInstance.getAudioStream();
	console.log("🎤 Microphone started - listening for speech...");

	// Set up buffer processing
	const bufferSize = vadOptions.frameSamples;
	let audioBuffer = new Float32Array(bufferSize);
	let bufferIndex = 0;

	// Process microphone data
	micInputStream.on("data", (data: Buffer) => {
		// Convert the incoming PCM data to float32
		const int16Data = new Int16Array(new Uint8Array(data).buffer);

		for (let i = 0; i < int16Data.length; i++) {
			// Convert Int16 to Float32 (-1.0 to 1.0)
			const sample = int16Data[i] / 32768.0;

			// Add to the current frame buffer
			audioBuffer[bufferIndex++] = sample;

			// When the buffer is full, process it
			if (bufferIndex >= bufferSize) {
				// Process the frame (don't await to avoid blocking the audio stream)
				vad
					.processFrame(audioBuffer)
					.catch((err) => console.error("Error processing frame:", err));

				// Reset for the next frame
				audioBuffer = new Float32Array(bufferSize);
				bufferIndex = 0;
			}
		}
	});

	// Start the mic
	micInstance.start();

	// Set up a handler for Ctrl+C
	process.on("SIGINT", async () => {
		console.log("\nStopping microphone...");
		micInstance.stop();
		vad.destroy();
		await audioContext.close();
		process.exit(0);
	});

	// Keep the process running
	await new Promise(() => {}); // This will never resolve
}

// Helper function to trim silence from the beginning and end of the audio
function trimSilence(audio: Float32Array, threshold = 0.01): Float32Array {
	let startIdx = 0;
	let endIdx = audio.length - 1;

	// Find the first sample above threshold
	while (startIdx < audio.length && Math.abs(audio[startIdx]) < threshold) {
		startIdx++;
	}

	// Find the last sample above threshold
	while (endIdx > startIdx && Math.abs(audio[endIdx]) < threshold) {
		endIdx--;
	}

	// Add a small buffer at the beginning and end (100ms = 1600 samples at 16kHz)
	const bufferSamples = 1600;
	startIdx = Math.max(0, startIdx - bufferSamples);
	endIdx = Math.min(audio.length - 1, endIdx + bufferSamples);

	// Return the trimmed audio
	return audio.slice(startIdx, endIdx + 1);
}

// Helper function to upsample audio from one sample rate to another
function upsampleAudio(
	audio: Float32Array,
	fromSampleRate: number,
	toSampleRate: number,
): Float32Array {
	if (fromSampleRate === toSampleRate) {
		return audio;
	}

	const ratio = toSampleRate / fromSampleRate;
	const newLength = Math.floor(audio.length * ratio);
	const result = new Float32Array(newLength);

	for (let i = 0; i < newLength; i++) {
		// Find the position in the original audio
		const position = i / ratio;
		const index = Math.floor(position);
		const fraction = position - index;

		// Simple linear interpolation
		if (index < audio.length - 1) {
			result[i] = audio[index] * (1 - fraction) + audio[index + 1] * fraction;
		} else {
			result[i] = audio[index];
		}
	}

	return result;
}

// Polyfill AudioContext for Node.js environment
if (!globalThis.AudioContext) {
	class MockAudioContext {
		sampleRate: number;

		constructor(options: { sampleRate: number }) {
			this.sampleRate = options.sampleRate;
		}

		createScriptProcessor() {
			return {
				connect: () => {},
				disconnect: () => {},
			};
		}

		createGain() {
			return {
				gain: { value: 0 },
				connect: () => {},
				disconnect: () => {},
			};
		}

		get destination() {
			return {};
		}

		close() {
			return Promise.resolve();
		}
	}

	globalThis.AudioContext = MockAudioContext as any;
}

main().catch((error) => {
	console.error("Error:", error);
	process.exit(1);
});
