import { DatasetDetailView, DatasetsView } from '@/features/datasets/components/DatasetsView'

export function DatasetsPage() {
  return <DatasetsView />
}

interface DatasetDetailPageProps {
  suiteId: string
}

export function DatasetDetailPage(props: DatasetDetailPageProps) {
  return <DatasetDetailView {...props} />
}
