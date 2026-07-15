/**
 * Text/content synchronization for normalized adapter responses.
 *
 * @module
 */

import type { AdapterResponse } from "../types";
import { responseContent } from "../assistant-output";
import { replaceTextSlots } from "./stream-content";

/** Replace response text without leaving stale provider text content behind. */
export function replaceResponseText(
  response: AdapterResponse,
  text: string,
): AdapterResponse {
  const content = responseContent(response);
  const textSlots = content.filter((part) => part.type === "text");
  return {
    ...response,
    text,
    content: replaceTextSlots(
      content,
      textSlots.map((_, index) => (index === 0 ? text : "")),
      text,
    ),
  };
}
