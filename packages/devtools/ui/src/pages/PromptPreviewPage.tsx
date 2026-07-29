import { PromptPreviewView } from "@/features/prompt-preview/PromptPreviewView";

export function PromptPreviewPage({
  definitionId,
}: {
  readonly definitionId: string;
}) {
  return <PromptPreviewView definitionId={definitionId} />;
}
