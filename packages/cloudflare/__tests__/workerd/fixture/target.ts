import { durableTask } from "@use-crux/core/runtime";

/** Concrete generated-target stand-in used to prove Worker host normalization. */
export const nestedTask = durableTask("nested-workerd-fixture", {
  run: async () => undefined,
});
