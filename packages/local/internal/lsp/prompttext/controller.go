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

// Request supplies the scope-local authorities needed for one decoration pull.
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

// Decorations returns headings only when current semantic identity and exact
// transient structure agree. Every failure is a non-nil clear result.
func (c *Controller) Decorations(ctx context.Context, request Request) Result {
	if c == nil || c.documents == nil || c.coordinator == nil {
		return clearResult(transient.Revision{})
	}
	document, ok := c.documents.Snapshot(request.URI)
	if !ok {
		return clearResult(transient.Revision{})
	}
	clear := clearResult(document.Revision)
	if request.Views == nil || request.Analyzer == nil {
		return clear
	}
	documentRevision := indexview.DocumentRevision{
		OpenEpoch:  document.Revision.OpenEpoch,
		Version:    int(document.Revision.Version),
		SourceHash: document.Revision.SourceHash,
	}
	selection := request.Views.BestAvailableView(indexview.ViewRequest{
		ScopeID: request.ScopeID, File: request.File, Document: &documentRevision,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.RequireCurrent,
	})
	if selection.Status != indexview.ViewStatusExact || selection.View == nil {
		return clear
	}
	identities := canonicalTemplateRanges(
		selection.View.Publication, request.Root, request.File, document.Text,
	)
	if len(identities) == 0 {
		return clear
	}
	analysis, err := c.coordinator.Analyze(ctx, transient.Query{
		URI: request.URI, File: request.File, ScopeID: request.ScopeID,
		SourceEpoch: request.SourceEpoch, Analyzer: request.Analyzer,
	})
	if err != nil || analysis.Revision != document.Revision ||
		analysis.Result.Status.Kind == staticprotocol.PromptTextStatusUnsupported {
		return clear
	}
	decorations := make([]Decoration, 0)
	for _, template := range analysis.Result.Templates {
		if template.Status.Kind != staticprotocol.PromptTextStatusComplete {
			continue
		}
		if _, canonical := identities[editorRange(template.Range)]; !canonical {
			continue
		}
		decorations = append(decorations, headingDecorations(template)...)
	}
	return Result{Revision: document.Revision, Decorations: decorations}
}

// Close cancels current analysis and releases transient cached evidence.
func (c *Controller) Close() {
	if c != nil {
		c.coordinator.Close()
	}
}

func clearResult(revision transient.Revision) Result {
	return Result{Revision: revision, Decorations: []Decoration{}}
}
