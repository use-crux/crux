import { ExperimentDetailView, ExperimentsView } from '@/features/experiments/components/ExperimentsView'

export function ExperimentsPage() {
  return <ExperimentsView />
}

interface ExperimentDetailPageProps {
  experimentId: string
}

export function ExperimentDetailPage(props: ExperimentDetailPageProps) {
  return <ExperimentDetailView {...props} />
}
