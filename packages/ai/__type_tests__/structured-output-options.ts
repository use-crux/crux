import { createCruxAi, type AiSdkStructuredOutputResolver } from "../src";

const resolver: AiSdkStructuredOutputResolver = ({ model, usage }) => {
  void model;
  void usage;
  return undefined;
};

createCruxAi({ structuredOutput: { capabilities: resolver } });
createCruxAi({ structuredOutput: { unknownModel: "passthrough" } });
createCruxAi({ structuredOutput: { unknownModel: "reject" } });

// @ts-expect-error unknown-model policy is closed
createCruxAi({ structuredOutput: { unknownModel: "infer" } });
