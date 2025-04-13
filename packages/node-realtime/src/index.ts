import * as fs from "node:fs/promises";
import * as ort from "onnxruntime-node";
import {
	FrameProcessor,
	type FrameProcessorOptions,
	Message,
	type NonRealTimeVADOptions,
	PlatformAgnosticNonRealTimeVAD,
	Resampler,
	utils,
} from "./common";
import {
	type RealTimeVADOptions,
	StreamVAD,
	defaultRealTimeVADOptions,
} from "./real-time-vad";

const modelPath = `${__dirname}/silero_vad.onnx`;

const modelFetcher = async (): Promise<ArrayBuffer> => {
	const contents = await fs.readFile(modelPath);
	return contents.buffer;
};

class NonRealTimeVAD extends PlatformAgnosticNonRealTimeVAD {
	static async new(
		options: Partial<NonRealTimeVADOptions> = {},
	): Promise<NonRealTimeVAD> {
		return await this._new(modelFetcher, ort, options);
	}
}

// Factory function to create a StreamVAD instance
async function createStreamVAD(
	options: Partial<RealTimeVADOptions> = {},
): Promise<StreamVAD> {
	return await StreamVAD.new(ort, modelFetcher, options);
}

export {
	FrameProcessor,
	Message,
	NonRealTimeVAD,
	Resampler,
	StreamVAD,
	createStreamVAD,
	defaultRealTimeVADOptions,
	utils,
};
export type {
	FrameProcessorOptions,
	NonRealTimeVADOptions,
	RealTimeVADOptions,
};
