export { FrameProcessor } from "./frame-processor";
export type { FrameProcessorOptions } from "./frame-processor";
export { Message } from "./messages";
import { arrayBufferToBase64, encodeWAV, minFramesForTargetMS } from "./utils";

export const utils = {
	minFramesForTargetMS,
	arrayBufferToBase64,
	encodeWAV,
};

export {
	AudioNodeVAD,
	DEFAULT_MODEL,
	getDefaultRealTimeVADOptions,
	MicVAD,
} from "./real-time-vad";
export type { RealTimeVADOptions } from "./real-time-vad";
