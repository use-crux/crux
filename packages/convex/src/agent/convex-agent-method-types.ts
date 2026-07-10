import type { Agent as UpstreamConvexAgent } from '@convex-dev/agent'

type UpstreamConvexThread = Awaited<ReturnType<UpstreamConvexAgent['continueThread']>>['thread']

/** Arguments accepted by upstream `Agent.generateText()` after ctx and target. */
export type ConvexGenerateTextArgs = Parameters<UpstreamConvexAgent['generateText']>[2]

/** Options accepted by upstream `Agent.generateText()`. */
export type ConvexGenerateTextOptions = Parameters<UpstreamConvexAgent['generateText']>[3]

/** Promise result returned by upstream `Agent.generateText()`. */
export type ConvexGenerateTextResult = ReturnType<UpstreamConvexAgent['generateText']>

/** Arguments accepted by upstream `Agent.streamText()` after ctx and target. */
export type ConvexStreamTextArgs = Parameters<UpstreamConvexAgent['streamText']>[2]

/** Options accepted by upstream `Agent.streamText()`. */
export type ConvexStreamTextOptions = Parameters<UpstreamConvexAgent['streamText']>[3]

/** Promise result returned by upstream `Agent.streamText()`. */
export type ConvexStreamTextResult = ReturnType<UpstreamConvexAgent['streamText']>

/** Arguments accepted by upstream `Agent.generateObject()` after ctx and target. */
export type ConvexGenerateObjectArgs = Parameters<UpstreamConvexAgent['generateObject']>[2]

/** Options accepted by upstream `Agent.generateObject()`. */
export type ConvexGenerateObjectOptions = Parameters<UpstreamConvexAgent['generateObject']>[3]

/** Promise result returned by upstream `Agent.generateObject()`. */
export type ConvexGenerateObjectResult = ReturnType<UpstreamConvexAgent['generateObject']>

/** Arguments accepted by upstream `Agent.streamObject()` after ctx and target. */
export type ConvexStreamObjectArgs = Parameters<UpstreamConvexAgent['streamObject']>[2]

/** Options accepted by upstream `Agent.streamObject()`. */
export type ConvexStreamObjectOptions = Parameters<UpstreamConvexAgent['streamObject']>[3]

/** Promise result returned by upstream `Agent.streamObject()`. */
export type ConvexStreamObjectResult = ReturnType<UpstreamConvexAgent['streamObject']>

/** Arguments accepted by an upstream continued thread's `generateText()`. */
export type ConvexThreadGenerateTextArgs = Parameters<UpstreamConvexThread['generateText']>[0]

/** Options accepted by an upstream continued thread's `generateText()`. */
export type ConvexThreadGenerateTextOptions = Parameters<UpstreamConvexThread['generateText']>[1]

/** Promise result returned by an upstream continued thread's `generateText()`. */
export type ConvexThreadGenerateTextResult = ReturnType<UpstreamConvexThread['generateText']>

/** Arguments accepted by an upstream continued thread's `streamText()`. */
export type ConvexThreadStreamTextArgs = Parameters<UpstreamConvexThread['streamText']>[0]

/** Options accepted by an upstream continued thread's `streamText()`. */
export type ConvexThreadStreamTextOptions = Parameters<UpstreamConvexThread['streamText']>[1]

/** Promise result returned by an upstream continued thread's `streamText()`. */
export type ConvexThreadStreamTextResult = ReturnType<UpstreamConvexThread['streamText']>

/** Arguments accepted by an upstream continued thread's `generateObject()`. */
export type ConvexThreadGenerateObjectArgs = Parameters<UpstreamConvexThread['generateObject']>[0]

/** Options accepted by an upstream continued thread's `generateObject()`. */
export type ConvexThreadGenerateObjectOptions = Parameters<UpstreamConvexThread['generateObject']>[1]

/** Promise result returned by an upstream continued thread's `generateObject()`. */
export type ConvexThreadGenerateObjectResult = ReturnType<UpstreamConvexThread['generateObject']>

/** Arguments accepted by an upstream continued thread's `streamObject()`. */
export type ConvexThreadStreamObjectArgs = Parameters<UpstreamConvexThread['streamObject']>[0]

/** Options accepted by an upstream continued thread's `streamObject()`. */
export type ConvexThreadStreamObjectOptions = Parameters<UpstreamConvexThread['streamObject']>[1]

/** Promise result returned by an upstream continued thread's `streamObject()`. */
export type ConvexThreadStreamObjectResult = ReturnType<UpstreamConvexThread['streamObject']>
