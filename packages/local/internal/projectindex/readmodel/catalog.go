package readmodel

import (
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// CatalogList projects every current definition into a stable kind/ID order.
func CatalogList(index api.IndexData, kind string) api.CatalogListV1 {
	root := catalogRoot(index)
	definitions := make([]api.CatalogListDefinitionV1, 0, len(index.Definitions))
	for _, definition := range index.Definitions {
		if kind != "" && definition.Kind != kind {
			continue
		}
		definitions = append(definitions, api.CatalogListDefinitionV1{
			ID: definition.ID, Kind: definition.Kind, Fidelity: definition.Fidelity,
			Status: definition.Status, Source: safeCatalogSource(root, definition.Source),
		})
	}
	sort.Slice(definitions, func(i, j int) bool {
		if definitions[i].Kind != definitions[j].Kind {
			return definitions[i].Kind < definitions[j].Kind
		}
		return definitions[i].ID < definitions[j].ID
	})
	return api.CatalogListV1{SchemaVersion: 1, Definitions: definitions}
}

// CatalogShow projects one current definition with its safe related evidence.
func CatalogShow(index api.IndexData, id string, activity *api.CatalogRuntimeActivityV1, evidence []api.CatalogEvidenceV1) (api.CatalogDefinitionV1, bool) {
	definition, found := catalogDefinition(index.Definitions, id)
	if !found {
		return api.CatalogDefinitionV1{}, false
	}
	root := catalogRoot(index)
	return api.CatalogDefinitionV1{
		SchemaVersion:   1,
		Definition:      safeCatalogDefinition(root, definition),
		Relations:       catalogRelations(root, index.Relations, id),
		Evidence:        sortedCatalogEvidence(evidence),
		Diagnostics:     catalogDiagnostics(root, index.Diagnostics, id),
		Lints:           catalogLints(root, index.LintFindings, id),
		Quality:         definition.Quality,
		RuntimeActivity: activity,
	}, true
}

// CatalogExplain builds the stable explanation contract from compiler-owned
// evidence. It never guesses a missing relation from source text.
func CatalogExplain(index api.IndexData, id string, evidence []api.CatalogEvidenceV1, manifest *api.CatalogManifestResolutionV1) (api.CatalogExplanationV1, bool) {
	show, found := CatalogShow(index, id, nil, evidence)
	if !found {
		return api.CatalogExplanationV1{}, false
	}
	unresolved := make([]api.CatalogUnresolvedRelationV1, 0)
	for _, diagnostic := range show.Diagnostics {
		if !strings.Contains(diagnostic.Code, "unresolved") && !strings.Contains(diagnostic.Code, "omitted") {
			continue
		}
		unresolved = append(unresolved, api.CatalogUnresolvedRelationV1{ID: diagnostic.ID, Reason: diagnostic.Message})
	}
	sort.Slice(unresolved, func(i, j int) bool { return unresolved[i].ID < unresolved[j].ID })
	indexing := api.CatalogExplanationIndexingV1{}
	if index.Indexing != nil {
		if index.Indexing.Cache != nil {
			indexing.Cache = index.Indexing.Cache.Status
		}
		indexing.Backend = index.Indexing.Semantic.Backend
		indexing.PartialReason = index.Indexing.Error
	}
	return api.CatalogExplanationV1{
		SchemaVersion: 1,
		Definition:    show.Definition,
		Evidence:      show.Evidence,
		Relations: api.CatalogExplanationRelationsV1{
			Incoming: show.Relations.Incoming, Outgoing: show.Relations.Outgoing,
			Unresolved: unresolved,
		},
		Diagnostics: show.Diagnostics,
		Lints:       show.Lints,
		Indexing:    indexing,
		Manifest:    manifest,
	}, true
}

// CatalogStatus combines current compiler, watch, and immutable manifest-store
// status without filling unknown values with successful zero states.
func CatalogStatus(index api.IndexData, watch api.ProjectIndexWatchStatus, manifestCount *int, current *api.CatalogManifestIdentityV1) api.CatalogStatusV1 {
	status := api.CatalogStatusV1{
		SchemaVersion: 1,
		Catalog: api.CatalogCountsV1{
			Definitions: len(index.Definitions), Relations: len(index.Relations),
			Diagnostics: len(index.Diagnostics), Lints: len(index.LintFindings),
		},
		Indexing:  index.Indexing,
		Manifests: api.CatalogManifestStatusV1{Count: manifestCount, Current: current},
	}
	if watch.State != "" {
		status.Watch = &watch
	}
	if index.Indexing != nil && index.Indexing.Semantic.Backend != "" {
		status.Semantic = &api.CatalogSemanticStatusV1{Backend: index.Indexing.Semantic.Backend}
	}
	return status
}

func catalogDefinition(definitions []api.ProjectDefinition, id string) (api.ProjectDefinition, bool) {
	for _, definition := range definitions {
		if definition.ID == id {
			return definition, true
		}
	}
	return api.ProjectDefinition{}, false
}

func catalogRelations(root string, relations []api.ProjectRelation, id string) api.CatalogRelationsV1 {
	result := api.CatalogRelationsV1{Incoming: []api.ProjectRelation{}, Outgoing: []api.ProjectRelation{}}
	for _, relation := range relations {
		relation.Source = safeCatalogSource(root, relation.Source)
		relation.Metadata = nil
		if relation.To == id {
			result.Incoming = append(result.Incoming, relation)
		}
		if relation.From == id {
			result.Outgoing = append(result.Outgoing, relation)
		}
	}
	sortRelations(result.Incoming)
	sortRelations(result.Outgoing)
	return result
}

func sortRelations(relations []api.ProjectRelation) {
	sort.Slice(relations, func(i, j int) bool {
		if relations[i].Type != relations[j].Type {
			return relations[i].Type < relations[j].Type
		}
		return relations[i].ID < relations[j].ID
	})
}

func catalogDiagnostics(root string, diagnostics []api.IndexDiagnostic, id string) []api.IndexDiagnostic {
	result := make([]api.IndexDiagnostic, 0)
	for _, diagnostic := range diagnostics {
		if containsString(diagnostic.RelatedDefinitionIDs, id) {
			diagnostic.Source = safeCatalogSource(root, diagnostic.Source)
			result = append(result, diagnostic)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

func catalogLints(root string, findings []api.IndexLintFinding, id string) []api.IndexLintFinding {
	result := make([]api.IndexLintFinding, 0)
	for _, finding := range findings {
		if finding.PrimaryDefinitionID == id || containsString(finding.RelatedDefinitionIDs, id) ||
			containsString(finding.AffectedDefinitionIDs, id) || containsString(finding.PropagatedDefinitionIDs, id) {
			result = append(result, safeCatalogLint(root, finding))
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

func sortedCatalogEvidence(evidence []api.CatalogEvidenceV1) []api.CatalogEvidenceV1 {
	result := append([]api.CatalogEvidenceV1(nil), evidence...)
	sort.Slice(result, func(i, j int) bool {
		left, right := catalogPhaseRank(result[i].Phase), catalogPhaseRank(result[j].Phase)
		if left != right {
			return left < right
		}
		if result[i].Producer != result[j].Producer {
			return result[i].Producer < result[j].Producer
		}
		return result[i].Reason < result[j].Reason
	})
	if result == nil {
		return []api.CatalogEvidenceV1{}
	}
	return result
}

func catalogPhaseRank(phase string) int {
	switch phase {
	case "ast":
		return 0
	case "semantic":
		return 1
	case "runtime":
		return 2
	case "quality":
		return 3
	default:
		return 4
	}
}
