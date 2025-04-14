Forked from https://github.com/ricky0123/vad which supports web and react. It used to support node, but it wasn't realtime. Here it's based for node and realtime.

See the project home for more details.

## Features

- Real-time and non-real-time voice activity detection
- Built on the Silero VAD model
- Easy to use API
- Works completely offline
- Efficient processing for server environments

## Installation

```bash
npm install @ericedouard/vad-node-realtime
```

## Usage

### Real-time VAD

Use `RealTimeVAD` when you need to process audio chunks in real time, such as receiving audio from a client application:

```javascript
const { RealTimeVAD } = require('@eric-edouard/vad-node-realtime');

async function example() {
  // Create a new RealTimeVAD instance
  const vad = await RealTimeVAD.new({
    onSpeechStart: () => {
      console.log('Speech started');
    },
    onSpeechEnd: (audio) => {
      console.log('Speech ended, received audio of length:', audio.length);
      // Process the audio data here
    },
    // Optional: customize VAD parameters
    positiveSpeechThreshold: 0.6,
    negativeSpeechThreshold: 0.4,
    minSpeechFrames: 4,
  });

  // Start processing
  vad.start();

  // When you receive audio chunks from your source:
  function onAudioChunkReceived(audioChunk) {
    // Process each chunk of audio data
    // audioChunk should be a Float32Array with sample rate matching the sampleRate option (default: 16000Hz)
    await vad.processAudio(audioChunk);
  }

  // When you're done with the stream:
  await vad.flush(); // Process any remaining audio
  vad.destroy(); // Clean up resources
}

example();
```

### Non-real-time VAD

For processing entire audio files or pre-recorded chunks:

```javascript
const { NonRealTimeVAD } = require('@eric-edouard/vad-node-realtime');

async function example() {
  const vad = await NonRealTimeVAD.new();
  
  // audioData is a Float32Array of audio samples
  // sampleRate is the sample rate of the audio
  for await (const { audio, start, end } of vad.run(audioData, sampleRate)) {
    console.log(`Speech detected from ${start}ms to ${end}ms`);
    // Process detected speech segment
  }
}
```

## API Reference

### RealTimeVAD

- `RealTimeVAD.new(options)`: Create a new RealTimeVAD instance
- `start()`: Start processing audio
- `pause()`: Pause processing audio
- `processAudio(audioData)`: Process a chunk of audio data
- `flush()`: Process any remaining audio and trigger final callbacks
- `reset()`: Reset the VAD state
- `destroy()`: Clean up resources

### RealTimeVADOptions

- `sampleRate`: Sample rate of the input audio (default: 16000, inputs with different sample rates will be automatically resampled)
- `onSpeechStart`: Callback when speech starts
- `onSpeechEnd`: Callback when speech ends, with the audio data
- `onVADMisfire`: Callback when speech was detected but was too short
- `onFrameProcessed`: Callback after each frame is processed
- `positiveSpeechThreshold`: Threshold for detecting speech (0-1)
- `negativeSpeechThreshold`: Threshold for detecting silence (0-1)
- `minSpeechFrames`: Minimum number of frames to consider as speech

## License

ISC
