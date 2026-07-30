package prompttext

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

// PreviewTargetKind identifies the exact current selection proof requested by
// the editor client.
type PreviewTargetKind string

const (
	PreviewTargetPosition      PreviewTargetKind = "position"
	PreviewTargetTemplateRange PreviewTargetKind = "template-range"
)

// PreviewTarget selects one template without treating source-order ordinals as
// durable identity.
type PreviewTarget struct {
	Kind     PreviewTargetKind
	Position protocol.Position
	Range    protocol.Range
}

// PreviewResultKind is the closed static-preview selection outcome.
type PreviewResultKind string

const (
	PreviewResultReady       PreviewResultKind = "ready"
	PreviewResultChoose      PreviewResultKind = "choose"
	PreviewResultUnavailable PreviewResultKind = "unavailable"
)

// PreviewSelection is one request-local source-order choice.
type PreviewSelection struct {
	Ordinal uint32
	Range   protocol.Range
}

// PreviewResult projects one template from the shared transient analysis.
type PreviewResult struct {
	Revision       transient.Revision
	Kind           PreviewResultKind
	Reason         string
	Selection      PreviewSelection
	Choices        []PreviewSelection
	RequestStatus  staticprotocol.PromptTextStatusKind
	TemplateStatus staticprotocol.PromptTextStatusKind
	PreviewStatus  staticprotocol.PromptTextPreviewStatusKind
	Evidence       staticprotocol.PromptTextPreviewEvidence
	Text           string
	Truncation     *staticprotocol.PromptTextPreviewTruncation
}

// StaticPreview returns exact projected bytes for one current lexical
// candidate. Semantic evidence is optional and contributes only fragment joins.
func (c *Controller) StaticPreview(
	ctx context.Context,
	request Request,
	target PreviewTarget,
) PreviewResult {
	document, analysis, ok := c.previewAnalysis(ctx, request)
	if !ok {
		return unavailablePreview(document.Revision, "analysis-unavailable")
	}
	if analysis.Status.Kind == staticprotocol.PromptTextStatusUnsupported {
		return unavailablePreview(document.Revision, "request-unsupported")
	}
	if len(analysis.Templates) == 0 {
		return unavailablePreview(document.Revision, "template-not-found")
	}
	selected, choices, reason := selectPreviewTemplate(analysis.Templates, target)
	if reason != "" {
		return unavailablePreview(document.Revision, reason)
	}
	if len(choices) != 0 {
		return PreviewResult{
			Revision: document.Revision, Kind: PreviewResultChoose,
			RequestStatus: analysis.Status.Kind, Choices: choices,
		}
	}
	template := analysis.Templates[selected]
	if template.Status.Kind == staticprotocol.PromptTextStatusUnsupported {
		return unavailablePreview(document.Revision, "template-unsupported")
	}
	if template.Preview.Status.Kind == staticprotocol.PromptTextPreviewUnavailable ||
		template.Preview.Evidence == nil {
		return unavailablePreview(document.Revision, "preview-unavailable")
	}
	return PreviewResult{
		Revision: document.Revision,
		Kind:     PreviewResultReady,
		Selection: PreviewSelection{
			Ordinal: uint32(selected), Range: editorRange(template.Range),
		},
		RequestStatus:  analysis.Status.Kind,
		TemplateStatus: template.Status.Kind,
		PreviewStatus:  template.Preview.Status.Kind,
		Evidence:       *template.Preview.Evidence,
		Text:           template.Preview.Text,
		Truncation:     template.Preview.Truncation,
	}
}

func selectPreviewTemplate(
	templates []staticprotocol.PromptTextTemplate,
	target PreviewTarget,
) (int, []PreviewSelection, string) {
	if target.Kind == PreviewTargetTemplateRange {
		match := -1
		for index, template := range templates {
			if editorRange(template.Range) != target.Range {
				continue
			}
			if match >= 0 {
				return 0, nil, "template-ambiguous"
			}
			match = index
		}
		if match < 0 {
			return 0, nil, "template-not-found"
		}
		return match, nil, ""
	}
	if target.Kind != PreviewTargetPosition {
		return 0, nil, "template-not-found"
	}
	if len(templates) == 1 {
		return 0, nil, ""
	}
	containing := make([]int, 0, len(templates))
	for index, template := range templates {
		if rangeContainsPosition(editorRange(template.Range), target.Position) {
			containing = append(containing, index)
		}
	}
	if len(containing) == 0 {
		choices, unique := previewChoices(
			templates,
			allTemplateIndexes(len(templates)),
		)
		if !unique {
			return 0, nil, "template-ambiguous"
		}
		return 0, choices, ""
	}
	innermost := make([]int, 0, len(containing))
	for _, candidate := range containing {
		isOuter := false
		for _, other := range containing {
			if candidate != other && strictlyContainsRange(
				editorRange(templates[candidate].Range),
				editorRange(templates[other].Range),
			) {
				isOuter = true
				break
			}
		}
		if !isOuter {
			innermost = append(innermost, candidate)
		}
	}
	if len(innermost) == 1 {
		return innermost[0], nil, ""
	}
	choices, unique := previewChoices(templates, innermost)
	if !unique {
		return 0, nil, "template-ambiguous"
	}
	return 0, choices, ""
}

func previewChoices(
	templates []staticprotocol.PromptTextTemplate,
	indexes []int,
) ([]PreviewSelection, bool) {
	choices := make([]PreviewSelection, 0, len(indexes))
	ranges := make(map[protocol.Range]struct{}, len(indexes))
	for _, index := range indexes {
		sourceRange := editorRange(templates[index].Range)
		if _, exists := ranges[sourceRange]; exists {
			return nil, false
		}
		ranges[sourceRange] = struct{}{}
		choices = append(choices, PreviewSelection{
			Ordinal: uint32(index), Range: sourceRange,
		})
	}
	return choices, true
}

func allTemplateIndexes(length int) []int {
	indexes := make([]int, length)
	for index := range indexes {
		indexes[index] = index
	}
	return indexes
}

func rangeContainsPosition(sourceRange protocol.Range, position protocol.Position) bool {
	return compareEditorPosition(sourceRange.Start, position) <= 0 &&
		compareEditorPosition(position, sourceRange.End) < 0
}

func strictlyContainsRange(outer, inner protocol.Range) bool {
	return outer != inner &&
		compareEditorPosition(outer.Start, inner.Start) <= 0 &&
		compareEditorPosition(inner.End, outer.End) <= 0
}

func (c *Controller) previewAnalysis(
	ctx context.Context,
	request Request,
) (transient.Document, readmodel.PromptTextResult, bool) {
	if c == nil || c.documents == nil || c.coordinator == nil || ctx.Err() != nil {
		return transient.Document{}, readmodel.PromptTextResult{}, false
	}
	document, ok := c.documents.Snapshot(request.URI)
	if !ok || request.Analyzer == nil {
		return document, readmodel.PromptTextResult{}, false
	}
	var baseGeneration, viewRevision uint64
	var fragments []staticprotocol.PromptTextFragment
	var fragmentJoins []staticprotocol.PromptTextFragmentJoin
	selection := currentSemanticView(request, document)
	if selection.Status == indexview.ViewStatusExact && selection.View != nil {
		baseGeneration = selection.View.Stamp.BaseGeneration
		viewRevision = selection.View.Stamp.Revision
		fragments, fragmentJoins = semanticPreviewEvidence(
			selection.View.Publication, request.Root, request.File, document.Text,
		)
	}
	analysis, err := c.coordinator.Analyze(ctx, transient.Query{
		URI: request.URI, File: request.File, ScopeID: request.ScopeID,
		SourceEpoch: request.SourceEpoch, BaseGeneration: baseGeneration,
		ViewRevision: viewRevision, Fragments: fragments,
		FragmentJoins: fragmentJoins, Analyzer: request.Analyzer,
	})
	if err != nil || ctx.Err() != nil || analysis.Revision != document.Revision {
		return document, readmodel.PromptTextResult{}, false
	}
	return document, analysis.Result, true
}

func unavailablePreview(revision transient.Revision, reason string) PreviewResult {
	return PreviewResult{
		Revision: revision, Kind: PreviewResultUnavailable, Reason: reason,
	}
}
