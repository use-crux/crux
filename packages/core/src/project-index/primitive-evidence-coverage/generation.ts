import { primitiveEvidenceCoverage as row } from "./descriptor";

/** Generation, media, prompt, context, agent, and flow audit rows. */
export const generationEvidenceCoverage = {
  run: row({ name: "run", participation: "subject" }),
  "generation.call": row({
    name: "generation.call",
    participation: "subject",
  }),
  "generation.stream": row({
    name: "generation.stream",
    participation: "subject",
  }),
  "generation.stream.attempt": row({
    name: "generation.stream.attempt",
    participation: "subject",
  }),
  "media.generate_image": row({
    name: "media.generate_image",
    participation: "subject",
  }),
  "media.transcribe": row({
    name: "media.transcribe",
    participation: "subject",
  }),
  "media.generate_speech": row({
    name: "media.generate_speech",
    participation: "subject",
  }),
  "media.describe": row({
    name: "media.describe",
    participation: "subject",
  }),
  "prompt.resolve": row({
    name: "prompt.resolve",
    participation: "subject",
  }),
  "prompt.budget": row({
    name: "prompt.budget",
    participation: "subject",
  }),
  "context.resolve": row({
    name: "context.resolve",
    participation: "subject",
  }),
  "context.predicate": row({
    name: "context.predicate",
    participation: "subject",
  }),
  "context.cache": row({
    name: "context.cache",
    participation: "subject",
  }),
  "agent.run": row({
    name: "agent.run",
    participation: "subject",
  }),
  "flow.run": row({
    name: "flow.run",
    participation: "subject",
  }),
  "flow.step": row({
    name: "flow.step",
    participation: "subject",
  }),
  "flow.suspension": row({
    name: "flow.suspension",
    participation: "subject",
  }),
};
