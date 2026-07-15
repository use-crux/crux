package observability

import "github.com/use-crux/crux/packages/local/internal/store"

// CurrentCatalogDefinitionComparison reports only identity presence. It never
// copies authored descriptions, snippets, metadata, or prompt/source content.
type CurrentCatalogDefinitionComparison struct {
	DefinitionID string `json:"definitionId"`
	Matched      bool   `json:"matched"`
}

// CurrentCatalogComparison is explicitly non-historical current-checkout data.
type CurrentCatalogComparison struct {
	Label       string                               `json:"label"`
	ProjectID   string                               `json:"projectId,omitempty"`
	Resolution  ManifestResolutionState              `json:"resolution"`
	Definitions []CurrentCatalogDefinitionComparison `json:"definitions"`
}

// CompareCurrentCatalog compares refs to the current snapshot without changing
// or substituting the exact historical manifest resolution. ProjectIdentity.Name
// is display metadata, so this comparison omits projectId unless a future API
// supplies an explicit stable identity.
func CompareCurrentCatalog(refs []DefinitionRef, index store.IndexData) CurrentCatalogComparison {
	comparison := CurrentCatalogComparison{
		Label: "current-catalog", Resolution: ManifestResolved,
		Definitions: make([]CurrentCatalogDefinitionComparison, 0, len(refs)),
	}
	definitions := make(map[string]struct{}, len(index.Definitions))
	for _, definition := range index.Definitions {
		definitions[definition.ID] = struct{}{}
	}
	for _, ref := range refs {
		_, matched := definitions[ref.ID]
		comparison.Definitions = append(comparison.Definitions, CurrentCatalogDefinitionComparison{
			DefinitionID: ref.ID, Matched: matched,
		})
		if !matched {
			comparison.Resolution = ManifestDefinitionUnresolved
		}
	}
	return comparison
}
