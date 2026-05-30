import { PlansView } from '@/features/plans/components/PlansView'

interface PlansPageProps {
  planId?: string
}

export function PlansPage(props: PlansPageProps) {
  return <PlansView {...props} />
}
