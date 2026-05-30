import { CompareView } from '@/features/experiments/components/CompareView'

interface ComparePageProps {
  comparisonId?: string
}

export function ComparePage(props: ComparePageProps) {
  return <CompareView {...props} />
}
