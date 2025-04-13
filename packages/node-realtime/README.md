# Voice Activity Detector for Node

Forked from https://github.com/ricky0123/vad which supports web and react. It used to support node, but it wasn't realtime.
Here it's based for node and realtime.

See the [project home](https://github.com/eric-edouard/vad-node-realtime) for more details.

## Examples

Check out the `examples/` directory for usage examples:

- `test-wav.ts`: Process a WAV file with a mock VAD model
- `test-vad-with-model.ts`: Process a WAV file with the actual Silero VAD model

### Running the examples

```bash
# Navigate to the examples directory
cd examples

# Install dependencies
npm install

# Run examples
npm run test-wav
npm run test-vad
```

Alternatively, you can run them directly using tsx:

```bash
npx tsx examples/test-wav.ts
npx tsx examples/test-vad-with-model.ts
```

## Installation

```bash
npm install @eric-edouard/vad-node-realtime
```
