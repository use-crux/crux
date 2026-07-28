import {
  bindStreamingOperation,
  defineStreamingOperation,
} from "../src/adapter";
import { createGeneratedImageResult, type GenerateImageOptions } from "../src";

const providerOwnedStart = defineStreamingOperation({
  normalize: (input: GenerateImageOptions<"image-model">) => input,
  support: () => "supported" as const,
  open: async () => ({
    events: (async function* () {
      yield "native-start";
    })(),
    map: () => ({ type: "start" as const }),
    completion: Promise.resolve({ requestId: "request-1" }),
  }),
  validate: (native) =>
    createGeneratedImageResult([], {
      warnings: [],
      execution: { kind: "native", calls: 1 },
      raw: native,
    }),
  report: () => ({}),
  conformance: [],
});

bindStreamingOperation({
  // @ts-expect-error Logical start and finish framing belongs exclusively to Core.
  definition: providerOwnedStart,
  provider: "test",
  operation: "streamImage",
});
