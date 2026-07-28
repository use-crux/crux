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

// LanguageRequest supplies the current semantic and transient authorities for
// PromptText navigation and hover.
type LanguageRequest struct {
	URI         protocol.DocumentURI
	File        string
	ScopeID     string
	SourceEpoch uint64
	Analyzer    readmodel.TransientSource
	Views       promptview.Provider
}

// NavigationResult distinguishes a recognized PromptText occurrence from a
// miss so the server can suppress its legacy line-based fallback while
// leaving interpolation and tag navigation to TypeScript.
type NavigationResult struct {
	Revision          transient.Revision
	Stamp             promptview.Stamp
	ContributingFiles []string
	Documents         []promptview.DocumentStamp
	Handled           bool
	Claimed           bool
	Definition        *protocol.Location
	References        []protocol.Location
}

// Navigation returns a contribution only from one current transformed view
// and one complete transient analysis. It retries one final-stamp race.
func (c *Controller) Navigation(
	ctx context.Context,
	request LanguageRequest,
	position protocol.Position,
	includeDeclaration bool,
) NavigationResult {
	var handled bool
	for attempt := 0; attempt < 2; attempt++ {
		result, retry := c.navigationAttempt(
			ctx,
			request,
			position,
			includeDeclaration,
		)
		handled = handled || result.Handled
		if !retry {
			return result
		}
	}
	return NavigationResult{Handled: handled, References: []protocol.Location{}}
}

func (c *Controller) navigationAttempt(
	ctx context.Context,
	request LanguageRequest,
	position protocol.Position,
	includeDeclaration bool,
) (NavigationResult, bool) {
	if c == nil || c.documents == nil || c.coordinator == nil ||
		request.Views == nil || ctx.Err() != nil {
		return NavigationResult{References: []protocol.Location{}}, false
	}
	document, ok := c.documents.Snapshot(request.URI)
	if !ok {
		return NavigationResult{References: []protocol.Location{}}, false
	}
	revision := indexview.DocumentRevision{
		OpenEpoch: document.Revision.OpenEpoch,
		Version:   document.Version, SourceHash: document.Revision.SourceHash,
	}
	selection := request.Views.Select(ctx, promptview.Request{
		ScopeID: request.ScopeID, File: request.File, Document: &revision,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	})
	if selection.Status == indexview.ViewStatusUnavailable || selection.View == nil {
		return NavigationResult{
			Revision: document.Revision, References: []protocol.Location{},
		}, false
	}
	suppressed := navigationAt(
		selection.View,
		staticprotocol.PromptTextQueryResponse{},
		request.File,
		position,
		includeDeclaration,
	)
	suppressed.Revision = document.Revision
	suppressed.Stamp = selection.View.Stamp
	if request.Analyzer == nil {
		return suppressed, false
	}
	analysis, err := c.coordinator.Analyze(ctx, transient.Query{
		URI: request.URI, File: request.File, ScopeID: request.ScopeID,
		SourceEpoch:    request.SourceEpoch,
		BaseGeneration: selection.View.Stamp.Project.BaseGeneration,
		ViewRevision:   selection.View.Stamp.Project.Revision,
		Analyzer:       request.Analyzer,
	})
	if err != nil || analysis.Revision != document.Revision {
		return suppressed, false
	}
	result := navigationAt(
		selection.View,
		analysis.Result,
		request.File,
		position,
		includeDeclaration,
	)
	result.Revision = document.Revision
	result.Stamp = selection.View.Stamp
	result.ContributingFiles, result.Documents =
		navigationDocumentStamps(selection.View, result)
	currentDocument, currentDocumentOK := c.documents.Snapshot(request.URI)
	if ctx.Err() != nil {
		return NavigationResult{
			Revision: document.Revision, Handled: result.Handled,
			References: []protocol.Location{},
		}, false
	}
	if !currentDocumentOK || currentDocument.Revision != document.Revision ||
		!request.Views.Current(selection.View.Stamp) {
		return result, true
	}
	return result, false
}
