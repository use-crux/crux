import type {
  CruxCurrentCatalogComparison,
  CruxRunDetail,
  CruxRunManifestResolution,
} from '../src/observability'

declare const detail: CruxRunDetail

const historical: CruxRunManifestResolution | undefined = detail.manifest
const current: CruxCurrentCatalogComparison | undefined = detail.currentCatalog

if (historical?.resolution === 'resolved') {
  const definitionId: string | undefined = historical.definitions[0]?.definition?.id
  void definitionId
}

if (current?.resolution === 'project-mismatch') {
  const label: 'current-catalog' = current.label
  void label
}

void historical
void current
