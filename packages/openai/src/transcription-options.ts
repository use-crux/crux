import type { OpenAITranscriptionInput } from "./transcription";

export function responseFormatFor(
  options: OpenAITranscriptionInput,
): "json" | "verbose_json" | "diarized_json" {
  if (options.diarization) return "diarized_json";
  if (requestedSegments(options) || requestedWords(options))
    return "verbose_json";
  return options.extra?.response_format ?? "json";
}

export function timestampGranularities(
  options: OpenAITranscriptionInput,
): readonly ("segment" | "word")[] | undefined {
  if (options.timestamps === "segment") return ["segment"];
  if (options.timestamps === "word") return ["word"];
  if (options.timestamps === "segment-and-word") return ["segment", "word"];
  return undefined;
}

export function requestedSegments(options: OpenAITranscriptionInput): boolean {
  return (
    options.diarization === true ||
    options.timestamps === "segment" ||
    options.timestamps === "segment-and-word"
  );
}

export function requestedWords(options: OpenAITranscriptionInput): boolean {
  return (
    options.timestamps === "word" || options.timestamps === "segment-and-word"
  );
}

export function openAITranscriptionIssue(options: OpenAITranscriptionInput) {
  if (isTranslation(options)) {
    const target = options.task.targetLanguage.toLowerCase();
    if (target !== "en" && target !== "english")
      return unsupportedControl(
        "transcription.translate.target",
        "task.targetLanguage",
      );
    if (options.model.startsWith("gpt-") || options.model.includes("diarize"))
      return unsupportedControl("transcription.translate.model", "model");
    if (options.language !== undefined)
      return unsupportedControl(
        "transcription.translate.source-language",
        "language",
      );
    if (options.diarization || requestedWords(options)) {
      return unsupportedControl(
        "transcription.translate.detail",
        options.diarization ? "diarization" : "timestamps",
      );
    }
  }
  if (options.diarization && !options.model.includes("diarize"))
    return unsupportedControl("transcription.diarization", "diarization");
  if (requestedWords(options) && options.model !== "whisper-1")
    return unsupportedControl("transcription.timestamps.word", "timestamps");
  if (
    requestedSegments(options) &&
    !options.diarization &&
    options.model !== "whisper-1"
  ) {
    return unsupportedControl("transcription.timestamps.segment", "timestamps");
  }
  if (options.diarization && options.prompt !== undefined)
    return unsupportedControl("transcription.prompt", "prompt");
  return undefined;
}

export function isTranslation(
  options: OpenAITranscriptionInput,
): options is OpenAITranscriptionInput & {
  readonly task: Readonly<{ type: "translate"; targetLanguage: string }>;
} {
  return typeof options.task === "object" && options.task.type === "translate";
}

function unsupportedControl(capability: string, path: string) {
  return {
    capability,
    path,
    remediation:
      "Choose an OpenAI transcription model that natively supports the requested detail.",
  };
}
