import * as fs from "node:fs";
import * as path from "node:path";
import type { Readable } from "node:stream";
import { RealTimeVAD, utils } from "../dist";

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

	// Create a RealTimeVAD instance with the simplified API
	console.log("Creating RealTimeVAD...");

	const vad = await RealTimeVAD.new({
		// Speech detection settings
		positiveSpeechThreshold: 0.3,
		negativeSpeechThreshold: 0.2,
		preSpeechPadFrames: 5,
		redemptionFrames: 8,

		// Event handlers
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

	// Start the VAD processing
	vad.start();

	// Start the microphone
	const micInputStream = micInstance.getAudioStream();
	console.log("🎤 Microphone started - listening for speech...");

	// Set up buffer processing
	const FRAME_SIZE = 480; // Default frame size for StreamVAD
	let audioBuffer = new Float32Array(FRAME_SIZE);
	let bufferIndex = 0;

	// Process microphone data
	micInputStream.on("data", async (data: Buffer) => {
		// Convert the incoming PCM data to float32
		const int16Data = new Int16Array(new Uint8Array(data).buffer);

		for (let i = 0; i < int16Data.length; i++) {
			// Convert Int16 to Float32 (-1.0 to 1.0)
			const sample = int16Data[i] / 32768.0;

			// Add to the current frame buffer
			audioBuffer[bufferIndex++] = sample;

			// When the buffer is full, process it
			if (bufferIndex >= FRAME_SIZE) {
				try {
					// Process the frame with the VAD
					await vad.processAudio(audioBuffer);
				} catch (err) {
					console.error("Error processing frame:", err);
				}

				// Reset for the next frame
				audioBuffer = new Float32Array(FRAME_SIZE);
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

		// Process any remaining audio
		if (bufferIndex > 0) {
			const paddedBuffer = new Float32Array(FRAME_SIZE);
			paddedBuffer.set(audioBuffer.slice(0, bufferIndex));
			await vad.processAudio(paddedBuffer);
		}

		// Clean up
		await vad.flush();
		vad.destroy();

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

main().catch((error) => {
	console.error("Error:", error);
	process.exit(1);
});
