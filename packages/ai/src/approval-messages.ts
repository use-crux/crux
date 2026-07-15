/** AI SDK approval-part decoding for durable Crux message metadata. */

import { isRecord, readString } from './object-utils'

/** Project one native approval request into Core's provider-neutral shape. */
export function approvalRequestFromAiSdkPart(request: Record<string, unknown>): Record<string, unknown> {
  const toolCall = isRecord(request.toolCall) ? request.toolCall : undefined
  return {
    approvalId: readString(request, 'approvalId') ?? '',
    toolCallId: readString(request, 'toolCallId') ?? readString(toolCall, 'toolCallId') ?? '',
    ...((readString(request, 'toolName') ?? readString(toolCall, 'toolName'))
      ? { toolName: readString(request, 'toolName') ?? readString(toolCall, 'toolName') }
      : {}),
    ...(request.input !== undefined || toolCall?.input !== undefined
      ? { input: request.input ?? toolCall?.input }
      : {}),
    ...(readString(request, 'approvalToken') ? { approvalToken: readString(request, 'approvalToken') } : {}),
    ...(isRecord(request.request) ? { request: request.request } : {}),
    ...(isRecord(request.replay) ? { replay: request.replay } : {}),
  }
}
