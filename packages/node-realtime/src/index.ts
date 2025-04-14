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
	RealTimeVAD as BaseRealTimeVAD,
	type RealTimeVADOptions,
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
		return await PlatformAgnosticNonRealTimeVAD._new(
			modelFetcher,
			ort,
			options,
		);
	}
}

class RealTimeVAD extends BaseRealTimeVAD {
	static override async new(
		options: Partial<RealTimeVADOptions> = {},
	): Promise<RealTimeVAD> {
		return await BaseRealTimeVAD._new(modelFetcher, ort, options);
	}
}

export {
	FrameProcessor,
	Message,
	NonRealTimeVAD,
	RealTimeVAD,
	Resampler,
	defaultRealTimeVADOptions,
	utils,
};
export type {
	FrameProcessorOptions,
	NonRealTimeVADOptions,
	RealTimeVADOptions,
};
