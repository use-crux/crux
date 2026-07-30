import { DevtoolsShell } from "@/devtools/shell/DevtoolsShell";
import { IndexView } from "@/features/index/components/IndexView";
import { PromptLatestRunEmptyStateController } from "@/features/prompt-latest-run/empty-state";

interface IndexPageProps {
  promptId?: string;
  contextId?: string;
  toolName?: string;
  tab?: string;
}

export function IndexPage(props: IndexPageProps) {
  if (props.tab === "runs" && props.promptId) {
    return (
      <DevtoolsShell
        breadcrumb="Library / Index / Prompt Runs"
        title="Prompt Runs"
        subtitle={props.promptId}
      >
        <PromptLatestRunEmptyStateController definitionId={props.promptId} />
      </DevtoolsShell>
    );
  }
  return <IndexView {...props} />;
}
