import { CatalogView } from '@/features/catalog/components/CatalogView'

interface CatalogPageProps {
  promptId?: string
  contextId?: string
  toolName?: string
  tab?: string
}

export function CatalogPage(props: CatalogPageProps) {
  return <CatalogView {...props} />
}
