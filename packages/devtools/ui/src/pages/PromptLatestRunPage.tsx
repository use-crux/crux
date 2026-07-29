import { PromptLatestRunResolver } from "@/features/prompt-latest-run/resolver";
import { DevtoolsShell } from "@/devtools/shell/DevtoolsShell";

export function PromptLatestRunPage({
  definitionId,
}: {
  readonly definitionId: string;
}) {
  return (
    <DevtoolsShell
      breadcrumb="Library / Index / Latest Run"
      title="Opening latest Run"
      subtitle={definitionId}
    >
      <PromptLatestRunResolver definitionId={definitionId} />
    </DevtoolsShell>
  );
}
