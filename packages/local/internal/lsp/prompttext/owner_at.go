package prompttext

import (
	"context"

	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

type OwnerAtKind string

const (
	OwnerAtReady       OwnerAtKind = "ready"
	OwnerAtStaticOnly  OwnerAtKind = "static-only"
	OwnerAtUnavailable OwnerAtKind = "unavailable"
)

type OwnerAtResult struct {
	Revision     transient.Revision
	Stamp        promptview.Stamp
	Kind         OwnerAtKind
	Reason       string
	DefinitionID string
}

func (c *Controller) ownerAt(
	ctx context.Context,
	request LanguageRequest,
	position protocol.Position,
) OwnerAtResult {
	unavailable := unavailableOwnerAt("analysis-unavailable")
	if c == nil || c.documents == nil || c.coordinator == nil ||
		request.Views == nil || request.Analyzer == nil || ctx.Err() != nil {
		return unavailable
	}
	document, ok := c.documents.Snapshot(request.URI)
	if !ok {
		return unavailable
	}
	unavailable.Revision = document.Revision
	revision := indexview.DocumentRevision{
		OpenEpoch: document.Revision.OpenEpoch,
		Version:   document.Version, SourceHash: document.Revision.SourceHash,
	}
	selection := request.Views.Select(ctx, promptview.Request{
		ScopeID: request.ScopeID, File: request.File, Document: &revision,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.RequireCurrent,
	})
	if selection.Status != indexview.ViewStatusExact || selection.View == nil {
		return unavailable
	}
	analysis, err := c.coordinator.Analyze(ctx, transient.Query{
		URI: request.URI, File: request.File, ScopeID: request.ScopeID,
		SourceEpoch:    request.SourceEpoch,
		BaseGeneration: selection.View.Stamp.Project.BaseGeneration,
		ViewRevision:   selection.View.Stamp.Project.Revision,
		Analyzer:       request.Analyzer,
	})
	if err != nil || ctx.Err() != nil || analysis.Revision != document.Revision {
		return unavailable
	}
	result := promptOwnerAt(
		selection.View, analysis.Result, request.File, position,
	)
	result.Revision = document.Revision
	result.Stamp = selection.View.Stamp
	current, currentOK := c.documents.Snapshot(request.URI)
	if !currentOK || current.Revision != document.Revision ||
		!request.Views.Current(selection.View.Stamp) {
		return unavailable
	}
	return result
}

func promptOwnerAt(
	view *promptview.View,
	analysis readmodel.PromptTextResult,
	file string,
	position protocol.Position,
) OwnerAtResult {
	if analysis.Status.Kind != staticprotocol.PromptTextStatusComplete {
		return unavailableOwnerAt("analysis-unavailable")
	}
	templates := templatesAt(analysis.Templates, position)
	if len(templates) == 0 {
		return unavailableOwnerAt("template-not-found")
	}
	if len(templates) != 1 {
		return unavailableOwnerAt("template-ambiguous")
	}
	template := templates[0]
	if template.Status.Kind == staticprotocol.PromptTextStatusUnsupported {
		return unavailableOwnerAt("template-unsupported")
	}
	if template.Status.Kind != staticprotocol.PromptTextStatusComplete ||
		!claimsPromptTextPosition(template, position) {
		return unavailableOwnerAt("template-not-found")
	}
	refs := refsAt(view, file, position)
	if len(refs) == 0 {
		return staticOnlyOwnerAt("ownerless")
	}
	if len(refs) != 1 || refs[0].Template.Range != editorRange(template.Range) {
		return unavailableOwnerAt("owner-unavailable")
	}
	ref := refs[0]
	switch ref.SourceKind {
	case promptview.PromptTextSourceNamedFragment:
		return staticOnlyOwnerAt("named-fragment")
	case promptview.PromptTextSourceAnonymousFragment:
		return staticOnlyOwnerAt("anonymous-fragment")
	case promptview.PromptTextSourceOwner:
	default:
		return unavailableOwnerAt("owner-unavailable")
	}
	definition, count := uniqueDefinition(view, ref.Key.DefinitionID)
	if count != 1 {
		return unavailableOwnerAt("owner-unavailable")
	}
	if definition.Kind == "context" {
		return staticOnlyOwnerAt("context-owner")
	}
	if definition.Kind != "prompt" {
		return unavailableOwnerAt("owner-unavailable")
	}
	return OwnerAtResult{
		Kind: OwnerAtReady, DefinitionID: definition.ID,
	}
}

func templatesAt(
	templates []staticprotocol.PromptTextTemplate,
	position protocol.Position,
) []staticprotocol.PromptTextTemplate {
	result := make([]staticprotocol.PromptTextTemplate, 0, 1)
	for _, template := range templates {
		if containsPosition(editorRange(template.Range), position) {
			result = append(result, template)
		}
	}
	return result
}

func uniqueDefinition(
	view *promptview.View,
	definitionID string,
) (promptview.Definition, int) {
	var result promptview.Definition
	count := 0
	for _, definition := range view.Definitions {
		if definition.ID == definitionID {
			result = definition
			count++
		}
	}
	return result, count
}

func staticOnlyOwnerAt(reason string) OwnerAtResult {
	return OwnerAtResult{Kind: OwnerAtStaticOnly, Reason: reason}
}

func unavailableOwnerAt(reason string) OwnerAtResult {
	return OwnerAtResult{Kind: OwnerAtUnavailable, Reason: reason}
}
