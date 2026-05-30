import { WorkspacesView } from '@/features/workspaces/components/WorkspacesView'

interface WorkspacesPageProps {
  workspaceId?: string
  filePath?: string
}

export function WorkspacesPage(props: WorkspacesPageProps) {
  return <WorkspacesView {...props} />
}
