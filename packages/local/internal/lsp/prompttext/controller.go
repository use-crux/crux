// Package prompttext joins saved semantic identity to transient, tag-neutral
// structure before exposing PromptText language features.
package prompttext

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

// Request supplies the scope-local authorities for one PromptText editor query.
type Request struct {
	URI         protocol.DocumentURI
	File        string
	Root        string
	ScopeID     string
	SourceEpoch uint64
	Analyzer    readmodel.TransientSource
	Views       indexview.ViewProvider
}

// Controller owns one coalesced transient analysis per current document.
type Controller struct {
	documents   transient.Source
	coordinator *transient.Coordinator
}

// NewController creates a PromptText controller over the existing LSP buffer.
func NewController(documents transient.Source) *Controller {
	return &Controller{
		documents: documents, coordinator: transient.NewCoordinator(documents),
	}
}

// Decorations returns mapped Markdown roles only when current semantic
// identity and exact transient structure agree. Every failure is a non-nil
// clear result.
func (c *Controller) Decorations(ctx context.Context, request Request) Result {
	document, analysis, identities, ok := c.currentSemanticAnalysis(ctx, request)
	if !ok {
		return clearResult(document.Revision)
	}
	decorations := make([]Decoration, 0)
	for _, template := range analysis.Templates {
		if template.Status.Kind != staticprotocol.PromptTextStatusComplete {
			continue
		}
		if _, canonical := identities[editorRange(template.Range)]; !canonical {
			continue
		}
		decorations = append(decorations, templateDecorations(template)...)
	}
	return Result{Revision: document.Revision, Decorations: decorations}
}

// Symbols returns Rust-labelled Markdown headings only when current canonical
// semantic identity and exact transient structure agree.
func (c *Controller) Symbols(ctx context.Context, request Request) SymbolResult {
	document, analysis, identities, ok := c.currentSemanticAnalysis(ctx, request)
	if !ok {
		return emptySymbolResult(document.Revision)
	}
	symbols := make([]protocol.DocumentSymbol, 0)
	for _, template := range analysis.Templates {
		if _, canonical := identities[editorRange(template.Range)]; !canonical {
			continue
		}
		symbols = append(symbols, templateHeadingSymbols(template)...)
	}
	return SymbolResult{Revision: document.Revision, Symbols: symbols}
}

// Folding returns parser-proven multiline structure for the current buffer.
// Unlike identity-sensitive features, it may consume explicitly labelled
// lexical candidates; exact revision checks still fail closed.
func (c *Controller) Folding(ctx context.Context, request Request) FoldingResult {
	if c == nil || c.documents == nil || c.coordinator == nil {
		return emptyFoldingResult(transient.Revision{})
	}
	document, ok := c.documents.Snapshot(request.URI)
	if !ok {
		return emptyFoldingResult(transient.Revision{})
	}
	empty := emptyFoldingResult(document.Revision)
	if request.Analyzer == nil {
		return empty
	}

	var baseGeneration, viewRevision uint64
	if selection := currentSemanticView(request, document); selection.Status == indexview.ViewStatusExact && selection.View != nil {
		baseGeneration = selection.View.Stamp.BaseGeneration
		viewRevision = selection.View.Stamp.Revision
	}
	analysis, err := c.coordinator.Analyze(ctx, transient.Query{
		URI: request.URI, File: request.File, ScopeID: request.ScopeID,
		SourceEpoch: request.SourceEpoch, BaseGeneration: baseGeneration,
		ViewRevision: viewRevision, Analyzer: request.Analyzer,
	})
	if err != nil || analysis.Revision != document.Revision ||
		analysis.Result.Status.Kind == staticprotocol.PromptTextStatusUnsupported {
		return empty
	}
	ranges := make([]protocol.FoldingRange, 0)
	for _, template := range analysis.Result.Templates {
		ranges = append(ranges, templateFoldingRanges(template)...)
	}
	return FoldingResult{
		Revision: document.Revision, Ranges: ranges,
		evidence: foldingEvidenceLexical,
	}
}

// Invalidate retires transient PromptText evidence for a changed or closed
// document without affecting another URI's current analysis.
func (c *Controller) Invalidate(uri protocol.DocumentURI) {
	if c != nil && c.coordinator != nil {
		c.coordinator.Invalidate(uri)
	}
}

// Close cancels current analysis and releases transient cached evidence.
func (c *Controller) Close() {
	if c != nil {
		c.coordinator.Close()
	}
}

func currentSemanticView(
	request Request,
	document transient.Document,
) indexview.ViewSelection {
	if request.Views == nil {
		return indexview.ViewSelection{Status: indexview.ViewStatusUnavailable}
	}
	documentRevision := indexview.DocumentRevision{
		OpenEpoch:  document.Revision.OpenEpoch,
		Version:    int(document.Revision.Version),
		SourceHash: document.Revision.SourceHash,
	}
	return request.Views.BestAvailableView(indexview.ViewRequest{
		ScopeID: request.ScopeID, File: request.File, Document: &documentRevision,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.RequireCurrent,
	})
}

func (c *Controller) currentSemanticAnalysis(
	ctx context.Context,
	request Request,
) (
	transient.Document,
	readmodel.PromptTextResult,
	map[protocol.Range]struct{},
	bool,
) {
	if c == nil || c.documents == nil || c.coordinator == nil || ctx.Err() != nil {
		return transient.Document{}, readmodel.PromptTextResult{}, nil, false
	}
	document, ok := c.documents.Snapshot(request.URI)
	if !ok || request.Views == nil || request.Analyzer == nil {
		return document, readmodel.PromptTextResult{}, nil, false
	}
	selection := currentSemanticView(request, document)
	if selection.Status != indexview.ViewStatusExact || selection.View == nil {
		return document, readmodel.PromptTextResult{}, nil, false
	}
	identities := canonicalTemplateRanges(
		selection.View.Publication, request.Root, request.File, document.Text,
	)
	if len(identities) == 0 {
		return document, readmodel.PromptTextResult{}, nil, false
	}
	analysis, err := c.coordinator.Analyze(ctx, transient.Query{
		URI: request.URI, File: request.File, ScopeID: request.ScopeID,
		SourceEpoch:    request.SourceEpoch,
		BaseGeneration: selection.View.Stamp.BaseGeneration,
		ViewRevision:   selection.View.Stamp.Revision,
		Analyzer:       request.Analyzer,
	})
	if err != nil || ctx.Err() != nil || analysis.Revision != document.Revision ||
		analysis.Result.Status.Kind == staticprotocol.PromptTextStatusUnsupported {
		return document, readmodel.PromptTextResult{}, nil, false
	}
	return document, analysis.Result, identities, true
}

func clearResult(revision transient.Revision) Result {
	return Result{Revision: revision, Decorations: []Decoration{}}
}
