import { IndexView } from "@/features/index/components/IndexView";

interface IndexPageProps {
  promptId?: string;
  contextId?: string;
  toolName?: string;
  tab?: string;
}

export function IndexPage(props: IndexPageProps) {
  return <IndexView {...props} />;
}
