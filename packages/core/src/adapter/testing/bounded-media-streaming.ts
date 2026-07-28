import type {
  GenerateImageResult,
  ImageStreamEvent,
  StreamImageResult,
} from "../../generation";
import type {
  GenerateSpeechResult,
  SpeechStreamEvent,
  StreamSpeechResult,
} from "../../speech";

type ImageProgressEvent = Extract<
  ImageStreamEvent,
  { readonly type: "image-preview" | "image-delta" }
>["type"];

/** One failed invariant from the bounded-media streaming test law. */
export interface BoundedMediaStreamingConformanceViolation {
  readonly operation: "image" | "speech";
  readonly message: string;
}

interface ConformanceRun<TResult> {
  readonly result: TResult;
  /** Exact native terminal object expected at `completion.raw`. */
  readonly raw: unknown;
  /** Native SDK calls made while opening the genuine provider stream. */
  readonly nativeCalls: number;
}

/** Fixture for one genuine bounded image stream. */
export interface BoundedImageStreamingConformanceCase {
  readonly operation: "image";
  readonly progressiveEvent: ImageProgressEvent;
  readonly completionKeys: readonly string[];
  readonly run: () => Promise<ConformanceRun<StreamImageResult>>;
}

/** Fixture for one genuine bounded speech stream. */
export interface BoundedSpeechStreamingConformanceCase {
  readonly operation: "speech";
  readonly progressiveEvent: "audio-delta";
  readonly completionKeys: readonly string[];
  readonly run: () => Promise<ConformanceRun<StreamSpeechResult>>;
}

/** Provider fixture accepted by {@link boundedMediaStreamingConformance}. */
export type BoundedMediaStreamingConformanceCase =
  | BoundedImageStreamingConformanceCase
  | BoundedSpeechStreamingConformanceCase;

/**
 * Exercise native image and speech streams through one provider-neutral law.
 *
 * The law requires one native call, canonical boundary ordering, genuine
 * progressive evidence before final publication, exact terminal `raw`
 * identity, exact enumerable completion keys, final-asset identity, and
 * identity-preserving replay. Provider suites supply SDK-shaped fakes so a
 * completed artifact cannot pass by being sliced into synthetic chunks.
 */
export async function boundedMediaStreamingConformance(
  cases: readonly BoundedMediaStreamingConformanceCase[],
): Promise<readonly BoundedMediaStreamingConformanceViolation[]> {
  const violations: BoundedMediaStreamingConformanceViolation[] = [];
  for (const fixture of cases) {
    if (fixture.operation === "image") {
      await inspectImage(fixture, violations);
    } else {
      await inspectSpeech(fixture, violations);
    }
  }
  return Object.freeze(violations.map((violation) => Object.freeze(violation)));
}

async function inspectImage(
  fixture: BoundedImageStreamingConformanceCase,
  violations: BoundedMediaStreamingConformanceViolation[],
): Promise<void> {
  const run = await fixture.run();
  const first = await collect(run.result.fullStream);
  const replay = await collect(run.result.fullStream);
  const completion = await run.result.completion;

  inspectCommon(fixture, run, first, replay, completion, violations);
  const finals = first.filter(
    (event): event is Extract<ImageStreamEvent, { readonly type: "image" }> =>
      event.type === "image",
  );
  if (
    finals.length !== completion.images.length ||
    finals.some((event, index) => event.image !== completion.images[index])
  ) {
    violate(violations, "image", "final images must share result identity");
  }
}

async function inspectSpeech(
  fixture: BoundedSpeechStreamingConformanceCase,
  violations: BoundedMediaStreamingConformanceViolation[],
): Promise<void> {
  const run = await fixture.run();
  const first = await collect(run.result.fullStream);
  const replay = await collect(run.result.fullStream);
  const completion = await run.result.completion;

  inspectCommon(fixture, run, first, replay, completion, violations);
  const final = first.find(
    (event): event is Extract<SpeechStreamEvent, { readonly type: "audio" }> =>
      event.type === "audio",
  );
  if (final?.audio !== completion.audio) {
    violate(violations, "speech", "final audio must share result identity");
  }
}

function inspectCommon(
  fixture: BoundedMediaStreamingConformanceCase,
  run: ConformanceRun<StreamImageResult | StreamSpeechResult>,
  first: readonly (ImageStreamEvent | SpeechStreamEvent)[],
  replay: readonly (ImageStreamEvent | SpeechStreamEvent)[],
  completion: GenerateImageResult | GenerateSpeechResult,
  violations: BoundedMediaStreamingConformanceViolation[],
): void {
  const types = first.map((event) => event.type);
  const progressive = types.indexOf(fixture.progressiveEvent);
  const finalType = fixture.operation === "image" ? "image" : "audio";
  const final = types.indexOf(finalType);
  const finalStrip = types.slice(final, -1);

  if (run.nativeCalls !== 1)
    violate(violations, fixture.operation, "must make exactly one native call");
  if (
    types[0] !== "start" ||
    types.at(-1) !== "finish" ||
    progressive < 1 ||
    final <= progressive ||
    finalStrip.length < 1 ||
    finalStrip.some((type) => type !== finalType)
  ) {
    violate(
      violations,
      fixture.operation,
      "events must order start, progressive evidence, final assets, finish",
    );
  }
  if (completion.raw !== run.raw)
    violate(violations, fixture.operation, "completion.raw identity changed");
  if (!equal(Object.keys(completion), fixture.completionKeys))
    violate(violations, fixture.operation, "completion keys changed");
  if (
    first.length !== replay.length ||
    first.some((event, index) => event !== replay[index])
  ) {
    violate(violations, fixture.operation, "replay changed event identity");
  }
}

async function collect<T>(stream: AsyncIterable<T>): Promise<readonly T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

function equal(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((value, i) => value === right[i])
  );
}

function violate(
  violations: BoundedMediaStreamingConformanceViolation[],
  operation: "image" | "speech",
  message: string,
): void {
  violations.push({ operation, message });
}
