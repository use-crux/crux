import { evaluate } from "@use-crux/core/eval";
import { remoteTask } from "../remote-task";

export default evaluate({
  task: remoteTask,
  cases: [
    { id: "remote-refund", input: { question: "remote refund" } },
    { id: "remote-exchange", input: { question: "remote exchange" } },
  ],
});
