/** Closed scalar decoders shared by bounded-media Runs projections. */

import { stringValue } from "./media-run-helpers";

const MIME_TOKEN = "[a-z0-9!#$&^_.+-]+";
const MIME_PARAMETER_VALUE = "[a-z0-9!#$&^_.+-]+";
const SAFE_MEDIA_TYPE = new RegExp(
  `^${MIME_TOKEN}/${MIME_TOKEN}(?:\\s*;\\s*${MIME_TOKEN}=${MIME_PARAMETER_VALUE})*$`,
  "iu",
);

/**
 * Retain only syntactically bounded MIME facts.
 *
 * Arbitrary strings, locators, filenames, and parameter values containing
 * separators are rejected instead of reaching the Runs view model.
 */
export function safeMediaTypes(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value.flatMap((item) => {
      const mediaType = stringValue(item);
      return mediaType &&
        mediaType.length <= 200 &&
        SAFE_MEDIA_TYPE.test(mediaType)
        ? [mediaType]
        : [];
    }),
  );
}
