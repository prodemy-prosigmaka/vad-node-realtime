# Voice Activity Detection (VAD) Examples

This directory contains example scripts demonstrating how to use the VAD (Voice Activity Detection) Node Real-time library in a Node.js environment.

## Prerequisites

Before running these examples, make sure you have:

1. Installed dependencies: `npm install`
2. Built the library: `npm run build` (from the project root)
3. Added a test.wav file to this directory (any WAV file with speech will work)

## Examples

### test-wav.ts

This example demonstrates how to process a WAV file with a mock VAD model. It:

1. Reads a WAV file using pure Node.js (no browser APIs)
2. Splits it into frames
3. Processes each frame with a simulated speech detection pattern
4. Saves detected speech segments as WAV files

```bash
# Run with tsx
npm run test-wav
```

### test-vad-with-model.ts

This example demonstrates how to use the actual Silero VAD model to process a WAV file. It:

1. Loads the Silero VAD model (either legacy or v5)
2. Reads and processes a WAV file frame by frame
3. Detects speech segments using the model
4. Saves detected speech segments as separate WAV files

```bash
# Run with tsx
npm run test-vad
```

### test-vad-simplified.ts (Recommended)

This is the **recommended example** that shows how to use the library with minimal code. It:

1. Uses the library's built-in model loading functionality
2. Demonstrates the proper way to use AudioNodeVAD class
3. Requires much less boilerplate code
4. Shows best practices for real applications

```bash
# Run with tsx
npm run test-simple
```

## Configuration Options

The Silero VAD model has several parameters you can adjust for better results:

1. **Speech detection threshold**: By default set to 0.5, but lower values (like 0.15) work better for lower quality audio files.

2. **Model type**: Two options are available:
   - `legacy`: Better for certain audio types and more lenient
   - `v5`: Newer model with different characteristics

3. **Frame size**: Different frame sizes can affect detection accuracy.

These parameters are configurable in the test-vad-with-model.ts file.

## Audio Quality Considerations

The VAD system works best with:

1. 16-bit WAV files (8-bit files may require adjusting detection thresholds)
2. 16kHz sample rate (higher sample rates work but may be less efficient)
3. Clear speech with good signal-to-noise ratio

For low-quality audio, the example includes automatic normalization for 8-bit audio files to improve detection.

## Output

All examples will:

1. Process the test.wav file
2. Print detailed logs during processing
3. Save any detected speech segments as WAV files in the project root
4. Display a summary of the results

## Troubleshooting

If you encounter issues:

1. Make sure you have a test.wav file in this directory
2. Check that the file is a valid WAV file (16-bit PCM is most reliable)
3. If no speech segments are detected:
   - Lower the `SPEECH_THRESHOLD` in the example (try 0.1 or 0.05)
   - Switch between the "legacy" and "v5" models
   - Try a different WAV file with clearer speech 