package view

import (
	"context"
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

// Options supplies scope path normalization for a transformed provider.
type Options struct {
	Root string
}

// LiveProvider joins one semantic publication to one atomic client-session
// transform snapshot. It never exposes or retains the selected publication.
type LiveProvider struct {
	base       indexview.ViewProvider
	root       string
	transforms *transformStore
}

// NewProvider creates a session-local transformed PromptText view provider.
func NewProvider(base indexview.ViewProvider, options Options) *LiveProvider {
	return &LiveProvider{
		base: base, root: filepath.Clean(options.Root),
		transforms: newTransformStore(),
	}
}

// Open establishes stable record ranges only from an exact semantic view of
// the opened bytes. An initially dirty buffer remains deliberately untracked.
func (p *LiveProvider) Open(request Request) bool {
	if p == nil || p.base == nil || request.Document == nil {
		return false
	}
	file := canonicalFile(p.root, request.File)
	if !p.transforms.reserve(file, *request.Document) {
		return false
	}
	selection := p.base.BestAvailableView(indexRequest(request))
	if selection.Status != indexview.ViewStatusExact || selection.View == nil {
		return false
	}
	source := selectedSourceHashes(selection.View, p.root)[file]
	if source.effective == "" || source.effective != request.Document.SourceHash {
		return false
	}
	normalized := normalizePublication(selection.View.Publication, p.root)
	return p.transforms.establishCurrent(
		file,
		*request.Document,
		source.base,
		normalized,
	)
}

// Change advances one open document's stable ranges through ordered
// incremental edits. Full-document or overlapping edits invalidate records.
func (p *LiveProvider) Change(
	file string,
	revision indexview.DocumentRevision,
	changes []protocol.TextDocumentContentChangeEvent,
) {
	if p != nil {
		p.transforms.change(canonicalFile(p.root, file), revision, changes)
	}
}

// Unavailable preserves the fact that a document is open when bounded buffer
// storage cannot retain its bytes. Saved ranges must not masquerade as closed
// destinations until the document is explicitly retired.
func (p *LiveProvider) Unavailable(
	file string,
	revision indexview.DocumentRevision,
) {
	if p != nil {
		p.transforms.unavailable(canonicalFile(p.root, file), revision)
	}
}

// Retire removes one document's transform chain after save or close.
func (p *LiveProvider) Retire(file string) {
	if p != nil {
		p.transforms.retire(canonicalFile(p.root, file))
	}
}

// RetireAll removes every chain after reconnect, handover, or scope retirement.
func (p *LiveProvider) RetireAll() {
	if p != nil {
		p.transforms.retireAll()
	}
}

// Select performs exactly one configured view selection, then joins its
// detached publication to exactly one locked transform snapshot.
func (p *LiveProvider) Select(ctx context.Context, request Request) Selection {
	if p == nil || p.base == nil || ctx.Err() != nil {
		return Selection{Status: indexview.ViewStatusUnavailable}
	}
	request.File = canonicalFile(p.root, request.File)
	selected := p.base.BestAvailableView(indexRequest(request))
	if selected.Status == indexview.ViewStatusUnavailable || selected.View == nil ||
		ctx.Err() != nil {
		return Selection{Status: indexview.ViewStatusUnavailable}
	}
	normalized := normalizePublication(selected.View.Publication, p.root)
	snapshot := p.transforms.snapshot()
	if request.Document != nil {
		if _, tracked := snapshot.documents[request.File]; !tracked {
			snapshot.documents[request.File] = documentTransform{
				revision: *request.Document,
				records:  make(map[string]trackedRange),
			}
		}
	}
	result := transformedView(
		normalized, snapshot, selectedSourceHashes(selected.View, p.root),
	)
	result.Stamp = Stamp{
		Project: selected.View.Stamp, TransformRevision: snapshot.revision,
		RequestDocument: cloneRevision(request.Document), requestFile: request.File,
	}
	return Selection{Status: selected.Status, View: &result}
}

// Current verifies that neither the selected Project Index publication nor
// the client-session transform snapshot has advanced.
func (p *LiveProvider) Current(stamp Stamp) bool {
	if p == nil || !p.transforms.current(stamp) {
		return false
	}
	current, ok := p.base.(interface {
		Current(indexview.ViewStamp) bool
	})
	return ok && current.Current(stamp.Project)
}

func indexRequest(request Request) indexview.ViewRequest {
	return indexview.ViewRequest{
		ScopeID: request.ScopeID, File: request.File,
		Document:        cloneRevision(request.Document),
		MinimumEvidence: request.MinimumEvidence,
		Freshness:       request.Freshness,
	}
}

func selectedSourceHashes(
	selected *indexview.ProjectIndexView,
	root string,
) map[string]selectedSourceHash {
	result := make(map[string]selectedSourceHash, len(selected.Sources))
	for file, source := range selected.Sources {
		result[canonicalFile(root, file)] = selectedSourceHash{
			effective: source.EffectiveSourceHash,
			base:      source.BaseSourceHash,
		}
	}
	return result
}

type selectedSourceHash struct {
	effective string
	base      string
}

func cloneRevision(value *indexview.DocumentRevision) *indexview.DocumentRevision {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
