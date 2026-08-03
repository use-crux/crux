/** Bounded polling backoff shared by durable Work observers. */

const INITIAL_WAIT_MS = 20;
const MAX_WAIT_MS = 250;

/** Wait with exponential bounded backoff and return the next attempt index. */
export async function waitForDurableWorkChange(
  attempt: number,
): Promise<number> {
  const delay = Math.min(
    MAX_WAIT_MS,
    INITIAL_WAIT_MS * 2 ** Math.min(attempt, 4),
  );
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
  return attempt + 1;
}
