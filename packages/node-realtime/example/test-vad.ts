import * as fs from "node:fs";
import * as path from "node:path";
import { AudioNodeVAD, getDefaultRealTimeVADOptions, utils } from "../dist";
import { readWavFile } from "./readWavFile";

async function main() {
	// Read the test.wav file
	console.log("Reading test.wav file...");
	const wavFilePath = path.resolve(__dirname, "./test.wav");
	const { audio, sampleRate } = await readWavFile(wavFilePath);
	console.log(
		`Original sample rate: ${sampleRate}, Audio length: ${audio.length} samples (${(audio.length / sampleRate).toFixed(2)}s)`,
	);

	// Create a simple audio context for the VAD to use
	const audioContext = new globalThis.AudioContext({
		sampleRate: 16000, // Use a fixed sample rate matching what the VAD expects
	});

	// Get default VAD options
	const vadOptions = getDefaultRealTimeVADOptions("legacy");

	// Lower the speech threshold since we're using 8-bit audio which has lower amplitude
	vadOptions.positiveSpeechThreshold = 0.1; // Default is higher, lower this for better sensitivity
	vadOptions.negativeSpeechThreshold = 0.05; // Adjust this accordingly

	// Initialize the VAD with options
	console.log("Creating AudioNodeVAD with adjusted speech thresholds...");
	console.log(
		`Speech detection threshold: ${vadOptions.positiveSpeechThreshold}`,
	);

	const vad = await AudioNodeVAD.new(audioContext, {
		...vadOptions,
		onSpeechStart: () => console.log("\nSpeech start detected"),
		onSpeechEnd: (audio: Float32Array) => {
			console.log(
				`\nSpeech end detected (duration: ${(audio.length / 16000).toFixed(2)}s)`,
			);

			// Upsample the detected speech back to the original sample rate to maintain correct playback speed
			const originalSampleRateAudio = upsampleAudio(audio, 16000, sampleRate);

			// Save the detected speech segment as 16-bit PCM with the original sample rate
			const segmentIndex = speechSegments.length + 1;
			const outputPath = path.resolve(
				__dirname,
				`../speech_segment_${segmentIndex}.wav`,
			);

			// Use format=1 for 16-bit PCM (better for playback) and use original sample rate
			const wavBuffer = utils.encodeWAV(originalSampleRateAudio, 1, sampleRate);
			fs.writeFileSync(outputPath, Buffer.from(wavBuffer));
			console.log(
				`Saved speech segment to ${outputPath} (${originalSampleRateAudio.length} samples at ${sampleRate}Hz)`,
			);

			// Add to our collection (keep the 16kHz version for internal use)
			speechSegments.push(audio);
		},
	});

	// Frame processing setup
	const frames: Float32Array[] = [];
	for (let i = 0; i < audio.length; i += vadOptions.frameSamples) {
		const frame = audio.slice(i, i + vadOptions.frameSamples);
		if (frame.length === vadOptions.frameSamples) {
			frames.push(frame);
		} else if (frame.length > 0) {
			// Pad the last frame if needed
			const paddedFrame = new Float32Array(vadOptions.frameSamples);
			paddedFrame.set(frame);
			frames.push(paddedFrame);
		}
	}

	console.log(`Split audio into ${frames.length} frames`);

	// Start the VAD processing
	vad.start();

	// Track speech segments
	const speechSegments: Float32Array[] = [];

	// Process each frame (simulating real-time audio)
	console.log("Processing frames...");
	const progressStep = Math.max(1, Math.floor(frames.length / 10));

	for (let i = 0; i < frames.length; i++) {
		// Show progress
		if (i % progressStep === 0 || i === frames.length - 1) {
			const percent = Math.round((i / frames.length) * 100);
			process.stdout.write(
				`Progress: ${percent}% (${i}/${frames.length} frames)\r`,
			);
		}

		// Process the frame
		await vad.processFrame(frames[i]);
	}

	// Clean up
	vad.destroy();
	await audioContext.close();

	console.log(
		`\nProcessing complete. Found ${speechSegments.length} speech segments.`,
	);
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

main().catch(console.error);
