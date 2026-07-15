package readmodel

import (
	"encoding/json"
	"path"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/projectindex/model"
)

// CatalogEvidence converts durable fact envelopes linked to one definition
// into the bounded public explanation shape. Related facts are evidence only
// when their durable envelope names an extractor contributor.
func CatalogEvidence(root string, facts []model.IndexFactEnvelope) []api.CatalogEvidenceV1 {
	evidence := make([]api.CatalogEvidenceV1, 0)
	for _, fact := range facts {
		if !catalogEvidencePhase(fact.Phase) {
			continue
		}
		source, supported := catalogEvidenceSource(root, fact)
		if !supported {
			continue
		}
		producer := fact.Producer.Name
		if fact.Producer.Version != "" {
			producer += "@" + fact.Producer.Version
		}
		evidence = append(evidence, api.CatalogEvidenceV1{
			Phase: string(fact.Phase), Producer: producer, Fidelity: fact.Fidelity,
			Source: source,
			Reason: catalogEvidenceReason(fact),
		})
	}
	return sortedCatalogEvidence(evidence)
}

func catalogEvidenceSource(root string, fact model.IndexFactEnvelope) (*api.SourceLoc, bool) {
	switch fact.Kind {
	case "definitions":
		var definition api.ProjectDefinition
		if err := json.Unmarshal(fact.Fact, &definition); err != nil {
			return nil, false
		}
		return safeCatalogSource(root, definition.Source), true
	case "relations":
		if len(fact.Provenance.Extractors) == 0 {
			return nil, false
		}
		var relation api.ProjectRelation
		if err := json.Unmarshal(fact.Fact, &relation); err != nil {
			return nil, false
		}
		return safeCatalogSource(root, relation.Source), true
	case "sourceRefs":
		if len(fact.Provenance.Extractors) == 0 {
			return nil, false
		}
		var sourceRef struct {
			Ref api.ProjectSourceRef `json:"ref"`
		}
		if err := json.Unmarshal(fact.Fact, &sourceRef); err != nil {
			return nil, false
		}
		return safeCatalogSource(root, &sourceRef.Ref.Source), true
	case "diagnostics":
		if len(fact.Provenance.Extractors) == 0 {
			return nil, false
		}
		var diagnostic api.IndexDiagnostic
		if err := json.Unmarshal(fact.Fact, &diagnostic); err != nil {
			return nil, false
		}
		return safeCatalogSource(root, diagnostic.Source), true
	default:
		return nil, false
	}
}

func catalogEvidencePhase(phase model.IndexPatchPhase) bool {
	switch phase {
	case model.PhaseAST, model.PhaseSemantic, model.PhaseRuntime, model.PhaseQuality:
		return true
	default:
		return false
	}
}

func catalogEvidenceReason(fact model.IndexFactEnvelope) string {
	label := strings.TrimSuffix(fact.Kind, "s") + " fact"
	reason := label
	switch fact.Provenance.Kind {
	case "source":
		if fact.Provenance.ExportName != "" {
			reason = label + " from source export " + fact.Provenance.ExportName
		} else {
			reason = label + " from source"
		}
	case "runtime":
		reason = label + " from runtime attribute " + fact.Provenance.Attribute
	case "filesystem":
		reason = label + " from filesystem convention " + fact.Provenance.Convention
	case "config":
		reason = label + " from configuration key " + fact.Provenance.Key
	case "cli":
		reason = label + " from CLI flag " + fact.Provenance.Flag
	}
	if len(fact.Provenance.Extractors) == 0 {
		return reason
	}
	labels := make([]string, 0, len(fact.Provenance.Extractors))
	for _, extractor := range fact.Provenance.Extractors {
		label := extractor.Name
		if extractor.Extension != nil {
			label = extractor.Extension.Name + "@" + extractor.Extension.Version + "/" + extractor.Name
		}
		labels = append(labels, label)
	}
	return reason + " via " + strings.Join(labels, ", ")
}

func safeCatalogSource(root string, source *api.SourceLoc) *api.SourceLoc {
	if source == nil {
		return nil
	}
	file := safeCatalogPath(root, source.File)
	if file == "" {
		return nil
	}
	copy := *source
	copy.File = file
	return &copy
}

func safeCatalogPath(root, file string) string {
	root = strings.ReplaceAll(root, "\\", "/")
	if root != "/" {
		root = strings.TrimSuffix(root, "/")
	}
	file = strings.ReplaceAll(file, "\\", "/")
	if file == "" || hasCatalogPathControl(file) {
		return ""
	}
	if isWindowsAbsolutePath(file) {
		if root == "" || !isWindowsAbsolutePath(root) || !strings.HasPrefix(strings.ToLower(file), strings.ToLower(root)+"/") {
			return ""
		}
		file = file[len(root)+1:]
	} else if path.IsAbs(file) {
		prefix := root + "/"
		if root == "/" {
			prefix = "/"
		}
		if root == "" || !path.IsAbs(root) || !strings.HasPrefix(file, prefix) {
			return ""
		}
		file = strings.TrimPrefix(file, prefix)
	} else if isWindowsDrivePath(file) {
		return ""
	}
	file = path.Clean(file)
	if file == "." || file == ".." || strings.HasPrefix(file, "../") || path.IsAbs(file) {
		return ""
	}
	return file
}

func isWindowsAbsolutePath(value string) bool {
	return len(value) >= 3 && isASCIIAlpha(value[0]) && value[1] == ':' && value[2] == '/'
}

func isWindowsDrivePath(value string) bool {
	return len(value) >= 2 && isASCIIAlpha(value[0]) && value[1] == ':'
}

func isASCIIAlpha(value byte) bool {
	return value >= 'a' && value <= 'z' || value >= 'A' && value <= 'Z'
}

func hasCatalogPathControl(value string) bool {
	return strings.IndexFunc(value, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0
}
