import { z } from "zod";

/** Authored separately so the Project Index emits a navigable schema source ref. */
export const writerInput = z.object({
  request: z.string(),
});
