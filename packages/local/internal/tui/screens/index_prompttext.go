package screens

import (
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/api"
)

type indexPromptTextEvidence struct {
	sources     []indexPromptTextSource
	refactors   []string
	diagnostics []indexPromptTextDiagnostic
}

type indexPromptTextSource struct {
	id, role, lifecycle, sourceKind, language string
	joins                                     []map[string]any
}

type indexPromptTextDiagnostic struct {
	code, severity, message, cause, sourceRefID, location string
}

func (b *indexDocumentBuilder) renderPromptText() {
	evidence := projectPromptTextEvidence(b.index, b.definition)
	if len(evidence.sources)+len(evidence.refactors)+len(evidence.diagnostics) == 0 {
		return
	}
	b.section("PROMPTTEXT · Canonical md · Markdown")
	for index, source := range evidence.sources {
		b.field(fmt.Sprintf("source %d", index+1), joinNonEmpty(" · ",
			source.sourceKind, source.role, source.lifecycle, source.language, source.id))
		for _, join := range source.joins {
			interpolation := scalarText(join["interpolationIndex"])
			target := scalarText(join["targetSourceRefId"])
			b.field("fragment", joinNonEmpty(" · ", "#"+interpolation, "→ "+target))
		}
	}
	for index, refactor := range evidence.refactors {
		b.field(fmt.Sprintf("refactor %d", index+1), refactor)
	}
	for index, diagnostic := range evidence.diagnostics {
		b.field(fmt.Sprintf("diagnostic %d", index+1),
			joinNonEmpty(" · ", diagnostic.code, diagnostic.severity, diagnostic.location))
		b.field("message", diagnostic.message)
		b.field("cause", joinNonEmpty(" · ", diagnostic.cause, diagnostic.sourceRefID))
	}
}

func projectPromptTextEvidence(index api.IndexData, definition api.ProjectDefinition) indexPromptTextEvidence {
	var evidence indexPromptTextEvidence
	projectRoot := index.ProjectRoot
	if projectRoot == "" && index.Project != nil {
		projectRoot = index.Project.Root
	}
	for _, ref := range definition.SourceRefs {
		metadata := ref.Metadata
		if len(metadata) == 0 {
			continue
		}
		if promptText, _ := metadata["promptText"].(map[string]any); promptText != nil {
			evidence.sources = append(evidence.sources, indexPromptTextSource{
				id: ref.ID, role: ref.Role,
				lifecycle:  scalarText(promptText["lifecycle"]),
				sourceKind: scalarText(promptText["sourceKind"]),
				language:   scalarText(promptText["language"]),
				joins:      mapSlice(promptText["fragmentJoins"]),
			})
		}
		if refactor, _ := metadata["promptTextRefactor"].(map[string]any); refactor != nil {
			binding := nestedMap(refactor, "binding")
			evidence.refactors = append(evidence.refactors, joinNonEmpty(" · ",
				scalarText(refactor["kind"]),
				"→ "+scalarText(refactor["target"]),
				scalarText(binding["kind"]),
				scalarText(binding["expression"]),
			))
		}
	}
	for _, diagnostic := range index.Diagnostics {
		if !stringSliceContains(diagnostic.RelatedDefinitionIDs, definition.ID) {
			continue
		}
		var raw map[string]any
		if len(diagnostic.Evidence) == 0 || json.Unmarshal(diagnostic.Evidence, &raw) != nil ||
			scalarText(raw["kind"]) != "prompt-text" {
			continue
		}
		cause := nestedMap(raw, "cause")
		location := ""
		if diagnostic.Source != nil {
			location = formatIndexSourceLocation(projectRoot, *diagnostic.Source, 48)
		}
		evidence.diagnostics = append(evidence.diagnostics, indexPromptTextDiagnostic{
			code: diagnostic.Code, severity: diagnostic.Severity, message: diagnostic.Message,
			cause: scalarText(cause["kind"]), sourceRefID: scalarText(raw["sourceRefId"]),
			location: location,
		})
	}
	appendMetadataPromptText(&evidence, definition.Metadata)
	return evidence
}

func appendMetadataPromptText(evidence *indexPromptTextEvidence, raw json.RawMessage) {
	var metadata map[string]any
	if len(raw) == 0 || json.Unmarshal(raw, &metadata) != nil {
		return
	}
	promptText, _ := metadata["promptText"].(map[string]any)
	if promptText == nil {
		return
	}
	for _, source := range mapSlice(promptText["sources"]) {
		evidence.sources = append(evidence.sources, indexPromptTextSource{
			id: scalarText(firstValue(source, "sourceRefId", "id")), role: scalarText(source["role"]),
			lifecycle: scalarText(source["lifecycle"]), sourceKind: scalarText(source["sourceKind"]),
			language: scalarText(source["language"]), joins: mapSlice(source["fragmentJoins"]),
		})
	}
	for _, refactor := range mapSlice(promptText["refactors"]) {
		binding := nestedMap(refactor, "binding")
		evidence.refactors = append(evidence.refactors, joinNonEmpty(" · ",
			scalarText(refactor["kind"]), "→ "+scalarText(refactor["target"]),
			scalarText(binding["kind"]), scalarText(binding["expression"])))
	}
	for _, diagnostic := range mapSlice(promptText["diagnostics"]) {
		cause := nestedMap(diagnostic, "cause")
		evidence.diagnostics = append(evidence.diagnostics, indexPromptTextDiagnostic{
			code: scalarText(diagnostic["code"]), severity: scalarText(diagnostic["severity"]),
			message: scalarText(diagnostic["message"]), cause: scalarText(cause["kind"]),
			sourceRefID: scalarText(diagnostic["sourceRefId"]), location: scalarText(diagnostic["location"]),
		})
	}
}

func mapSlice(value any) []map[string]any {
	items := make([]map[string]any, 0)
	for _, item := range anySlice(value) {
		if object, ok := item.(map[string]any); ok {
			items = append(items, object)
		}
	}
	return items
}

func scalarText(value any) string {
	switch typed := value.(type) {
	case string:
		return sanitizeIndexInline(typed)
	case float64:
		return fmt.Sprintf("%g", typed)
	case json.Number:
		return typed.String()
	default:
		return ""
	}
}

func firstValue(object map[string]any, keys ...string) any {
	for _, key := range keys {
		if value := object[key]; value != nil {
			return value
		}
	}
	return nil
}
