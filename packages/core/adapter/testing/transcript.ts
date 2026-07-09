/**
 * Conformance utilities for native transcript codecs.
 *
 * Transcript codecs own provider-native history conversion, assistant-turn
 * extraction, and optional canonical tool-round appends. These checks let
 * provider packages prove those laws directly without going through a fake SDK
 * client or the full `AdapterSpec` surface.
 *
 * @module
 */

import type { Message } from '../../generation/messages'
import type { NativeAssistantTurn, NativeTranscriptCodec } from '../native-chat'
import type { ToolResultEntry } from '../types'
import type { ConformanceViolation } from '../testing'

/** One expected wrapper result for a public transcript compatibility export. */
export interface TranscriptWrapperExpectation<TProviderMessage> {
  /** Public `fromMessages()` wrapper result for the canonical input. */
  readonly fromMessages?: readonly TProviderMessage[]
  /** Public `toMessages()` wrapper result for the provider input. */
  readonly toMessages?: Message[]
}

/** One provider-specific round-trip fixture for transcript codecs. */
export interface TranscriptRoundTripFixture<TProviderMessage> {
  /** Human-readable fixture name included in violation rules. */
  readonly name: string
  /** Canonical Crux transcript to encode. */
  readonly canonicalMessages: readonly Message[]
  /** Provider-native messages expected from `transcript.fromMessages()`. */
  readonly providerMessages: readonly TProviderMessage[]
  /** Provider-native messages to decode. Defaults to `providerMessages`. */
  readonly providerMessagesToDecode?: readonly unknown[]
  /** Canonical messages expected from `transcript.toMessages()`. */
  readonly decodedMessages: readonly Message[]
}

/** A compact provider-owned suite of transcript round-trip fixtures. */
export interface TranscriptRoundTripConformanceSuite<TProviderMessage, TRawResponse> {
  /** Human-readable suite name included in violation rules. */
  readonly name: string
  /** Provider transcript codec under test. */
  readonly transcript: NativeTranscriptCodec<TProviderMessage, TRawResponse>
  /** Round-trip fixtures to verify through the shared transcript boundaries. */
  readonly fixtures: readonly TranscriptRoundTripFixture<TProviderMessage>[]
}

/** A complete provider-owned transcript behavior scenario. */
export interface TranscriptConformanceScenario<TProviderMessage, TRawResponse> {
  /** Human-readable scenario name included in violation rules. */
  readonly name: string
  /** Provider transcript codec under test. */
  readonly transcript: NativeTranscriptCodec<TProviderMessage, TRawResponse>
  /** Canonical Crux transcript to encode. */
  readonly canonicalMessages: readonly Message[]
  /** Provider-native messages expected from `transcript.fromMessages()`. */
  readonly providerMessages: readonly TProviderMessage[]
  /** Provider-native messages to decode. Defaults to `providerMessages`. */
  readonly providerMessagesToDecode?: readonly unknown[]
  /** Canonical messages expected from `transcript.toMessages()`. */
  readonly decodedMessages: readonly Message[]
  /** Raw provider response used for assistant-turn extraction. */
  readonly rawAssistant: TRawResponse
  /** Canonical assistant turn expected from `transcript.readAssistant()`. */
  readonly assistant: NativeAssistantTurn
  /** Existing canonical history used for append checks. Defaults to `canonicalMessages`. */
  readonly appendHistory?: readonly Message[]
  /** Tool results used when checking `appendToolRound()`. */
  readonly toolResults?: readonly ToolResultEntry[]
  /** Expected appended canonical transcript. Required when `toolResults` is set. */
  readonly appendedMessages?: readonly Message[]
  /** Results expected from public compatibility wrappers around the transcript. */
  readonly wrappers?: TranscriptWrapperExpectation<TProviderMessage>
}

/**
 * Run shared round-trip laws against a set of provider-specific transcript fixtures.
 *
 * This helper is intentionally narrower than {@link transcriptCodecConformance}:
 * it focuses on `fromMessages()` and `toMessages()` so adapters can share one
 * multimodal fixture sweep without inventing raw assistant responses for every case.
 *
 * @param suite - Provider transcript codec and expected fixture outputs.
 * @returns Contract violations; an empty array means every fixture conforms.
 */
export function transcriptRoundTripConformance<TProviderMessage, TRawResponse>(
  suite: TranscriptRoundTripConformanceSuite<TProviderMessage, TRawResponse>,
): ConformanceViolation[] {
  const violations: ConformanceViolation[] = []
  for (const fixture of suite.fixtures) {
    const fail = (rule: string, detail: string) =>
      violations.push({ rule: `${suite.name}: ${fixture.name}: ${rule}`, detail })
    assertDeepEqual(
      suite.transcript.fromMessages(fixture.canonicalMessages),
      fixture.providerMessages,
      'fromMessages',
      fail,
    )
    assertDeepEqual(
      suite.transcript.toMessages(fixture.providerMessagesToDecode ?? fixture.providerMessages),
      fixture.decodedMessages,
      'toMessages',
      fail,
    )
  }
  return violations
}

/**
 * Run native transcript codec laws against one provider fixture.
 *
 * @param scenario - Provider transcript fixture and expected canonical results.
 * @returns Contract violations; an empty array means the transcript conforms.
 */
export function transcriptCodecConformance<TProviderMessage, TRawResponse>(
  scenario: TranscriptConformanceScenario<TProviderMessage, TRawResponse>,
): ConformanceViolation[] {
  const violations: ConformanceViolation[] = []
  const fail = (rule: string, detail: string) => violations.push({ rule: `${scenario.name}: ${rule}`, detail })

  assertDeepEqual(
    scenario.transcript.fromMessages(scenario.canonicalMessages),
    scenario.providerMessages,
    'fromMessages',
    fail,
  )
  assertDeepEqual(
    scenario.transcript.toMessages(scenario.providerMessagesToDecode ?? scenario.providerMessages),
    scenario.decodedMessages,
    'toMessages',
    fail,
  )
  assertDeepEqual(scenario.transcript.readAssistant(scenario.rawAssistant), scenario.assistant, 'readAssistant', fail)

  if (scenario.toolResults) {
    if (!scenario.appendedMessages) {
      fail('appendToolRound', 'toolResults were provided without appendedMessages')
    } else if (!scenario.transcript.appendToolRound) {
      fail('appendToolRound', 'transcript does not expose appendToolRound()')
    } else {
      assertDeepEqual(
        scenario.transcript.appendToolRound(
          scenario.appendHistory ?? scenario.canonicalMessages,
          scenario.assistant,
          scenario.toolResults,
        ),
        scenario.appendedMessages,
        'appendToolRound',
        fail,
      )
    }
  }

  if (scenario.wrappers?.fromMessages) {
    assertDeepEqual(scenario.wrappers.fromMessages, scenario.providerMessages, 'public fromMessages wrapper', fail)
  }
  if (scenario.wrappers?.toMessages) {
    assertDeepEqual(scenario.wrappers.toMessages, scenario.decodedMessages, 'public toMessages wrapper', fail)
  }

  return violations
}

function assertDeepEqual(
  actual: unknown,
  expected: unknown,
  rule: string,
  fail: (rule: string, detail: string) => void,
) {
  if (!deepEqual(actual, expected)) {
    fail(rule, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    return leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]))
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
