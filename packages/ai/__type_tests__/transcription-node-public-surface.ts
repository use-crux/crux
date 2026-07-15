import type { AITranscribe, SdkGateway } from "@use-crux/ai";
import {
  createAiSdkTranscribe,
  transcribe,
  type AITranscriptionExtra,
  type AITranscriptionMetadata,
} from "@use-crux/ai/transcription/node";

const gateway = null as unknown as SdkGateway;

const defaultOperation: AITranscribe = transcribe;
const injectedOperation: AITranscribe = createAiSdkTranscribe(gateway);

type NodeTranscriptionTypes = readonly [
  AITranscriptionExtra,
  AITranscriptionMetadata,
];

void defaultOperation;
void injectedOperation;
void (null as unknown as NodeTranscriptionTypes);
