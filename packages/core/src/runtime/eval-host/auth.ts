const MIN_TOKEN_LENGTH = 32;

/** Validate a dedicated Eval-execute capability at host construction. */
export function assertEvalHostToken(token: string): void {
  if (token.length >= MIN_TOKEN_LENGTH) return;
  throw new TypeError(
    "Eval host bearer capability must contain at least 32 characters.",
  );
}

/** Compare the supplied Bearer capability without content-dependent exits. */
export function hasEvalHostAuthorization(
  request: Request,
  expectedToken: string,
): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  const supplied = authorization.startsWith(prefix)
    ? authorization.slice(prefix.length)
    : "";
  return constantTimeEqual(supplied, expectedToken);
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}
