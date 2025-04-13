import * as fs from "node:fs";

/**
 * Simple function to read a WAV file in Node.js environment
 * This replaces utils.audioFileToArray which uses browser-only APIs
 */
export async function readWavFile(
	filePath: string,
): Promise<{ audio: Float32Array; sampleRate: number }> {
	// Read the file
	const buffer = fs.readFileSync(filePath);

	// Parse WAV header
	// WAV format reference: http://soundfile.sapp.org/doc/WaveFormat/

	// Verify RIFF header
	const header = buffer.subarray(0, 12);
	const riffHeader = header.toString("ascii", 0, 4);
	const waveHeader = header.toString("ascii", 8, 12);

	if (riffHeader !== "RIFF" || waveHeader !== "WAVE") {
		throw new Error("Invalid WAV file format");
	}

	// Get sample rate from header
	const sampleRate = buffer.readUInt32LE(24);
	console.log(`WAV sample rate: ${sampleRate}`);

	// Get number of channels
	const numChannels = buffer.readUInt16LE(22);
	console.log(`WAV channels: ${numChannels}`);

	// Get bits per sample
	const bitsPerSample = buffer.readUInt16LE(34);
	console.log(`WAV bits per sample: ${bitsPerSample}`);

	// Find data chunk
	let dataStart = 0;
	for (let i = 12; i < buffer.length - 8; i++) {
		if (
			buffer[i] === 100 && // 'd'
			buffer[i + 1] === 97 && // 'a'
			buffer[i + 2] === 116 && // 't'
			buffer[i + 3] === 97 // 'a'
		) {
			// Skip 'data' and dataSize (8 bytes total)
			dataStart = i + 8;
			break;
		}
	}

	if (dataStart === 0) {
		throw new Error("Could not find data chunk in WAV file");
	}

	// Convert data to Float32Array
	const audioData = buffer.subarray(dataStart);
	const bytesPerSample = bitsPerSample / 8;
	const numSamples = Math.floor(
		audioData.length / (numChannels * bytesPerSample),
	);
	const float32Data = new Float32Array(numSamples);

	// Perform normalization for 8-bit audio (which often has too low values for VAD)
	const normalizationFactor = bitsPerSample === 8 ? 2.0 : 1.0;

	for (let i = 0, offset = 0; i < numSamples; i++) {
		// Mix down to mono if necessary and convert to float32
		let sample = 0;

		for (let ch = 0; ch < numChannels; ch++) {
			if (bitsPerSample === 16) {
				// 16-bit samples (signed)
				sample += audioData.readInt16LE(offset) / 32768.0;
				offset += 2;
			} else if (bitsPerSample === 8) {
				// 8-bit samples (unsigned) with extra normalization
				const rawSample = (audioData[offset] - 128) / 128.0;
				sample += rawSample * normalizationFactor; // Boost 8-bit audio signals
				offset += 1;
			} else if (bitsPerSample === 32) {
				// 32-bit float
				sample += audioData.readFloatLE(offset);
				offset += 4;
			}
		}

		// Average for multiple channels
		float32Data[i] = Math.max(-1, Math.min(1, sample / numChannels));
	}

	return { audio: float32Data, sampleRate };
}
