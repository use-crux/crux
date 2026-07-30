// Package view selects coherent, request-relative Project Index publications.
package view

import "github.com/use-crux/crux/packages/local/internal/lsp/readmodel"

// EvidenceLevel identifies the strongest compiler evidence retained by a view.
type EvidenceLevel string

const (
	// EvidenceIndex contains source-index evidence without completed semantic enrichment.
	EvidenceIndex EvidenceLevel = "index"
	// EvidenceSemantic contains a semantic publication whose status is exactly ready.
	EvidenceSemantic EvidenceLevel = "semantic"
)

// FreshnessPolicy controls whether saved bytes may differ from an editor buffer.
type FreshnessPolicy string

const (
	// RequireCurrent rejects saved evidence that cannot prove the requesting bytes.
	RequireCurrent FreshnessPolicy = "require-current"
	// AllowSavedFallback permits coherent saved evidence after current evidence is unavailable.
	AllowSavedFallback FreshnessPolicy = "allow-saved-fallback"
)

// DocumentRevision identifies one buffer revision inside a client session.
// Versions are comparable only for the same URI and OpenEpoch. SourceHash uses
// the canonical Project Index SHA-256 representation.
type DocumentRevision struct {
	OpenEpoch  uint64
	Version    int
	SourceHash string
}

// ViewRequest describes the evidence and freshness required by one feature.
type ViewRequest struct {
	ScopeID         string
	File            string
	Document        *DocumentRevision
	MinimumEvidence EvidenceLevel
	Freshness       FreshnessPolicy
}

// ViewOrigin identifies the authority that produced a complete view.
type ViewOrigin string

const (
	ViewOriginSaved        ViewOrigin = "saved"
	ViewOriginDirtyOverlay ViewOrigin = "dirty-overlay"
)

// SourceOrigin identifies the bytes that supplied one source row.
type SourceOrigin string

const (
	SourceOriginSaved SourceOrigin = "saved"
	SourceOriginDirty SourceOrigin = "dirty"
)

// BufferMatch describes one source's relationship to the requesting editor.
type BufferMatch string

const (
	BufferMatchExact     BufferMatch = "exact"
	BufferMatchDifferent BufferMatch = "different"
	BufferMatchUnknown   BufferMatch = "unknown"
)

// ViewStatus is the only selection field feature behavior may branch on.
type ViewStatus string

const (
	ViewStatusExact         ViewStatus = "exact"
	ViewStatusSavedFallback ViewStatus = "saved-fallback"
	ViewStatusUnavailable   ViewStatus = "unavailable"
)

// ViewSelectionReason is stable diagnostic and telemetry metadata. Feature
// behavior must switch on ViewStatus instead.
type ViewSelectionReason string

const (
	ViewReasonNone                 ViewSelectionReason = ""
	ViewReasonGenerationUnknown    ViewSelectionReason = "generation-unknown"
	ViewReasonSourceHashUnknown    ViewSelectionReason = "source-hash-unknown"
	ViewReasonSourceDifferent      ViewSelectionReason = "source-different"
	ViewReasonEvidenceInsufficient ViewSelectionReason = "evidence-insufficient"
	ViewReasonDirtyUnavailable     ViewSelectionReason = "dirty-unavailable"
)

// ViewStamp is the canonical atomic identity for a selected publication.
type ViewStamp struct {
	ScopeID string

	// BaseGeneration is the authoritative saved generation under this view.
	// Keystrokes never increment it.
	BaseGeneration      uint64
	BaseGenerationKnown bool
	// Revision is the atomic session-local publication identity consumers use
	// for caches instead of BaseGeneration alone.
	Revision uint64
	// OverlayRevision orders session-private dirty views. Saved views use zero.
	OverlayRevision uint64

	Origin   ViewOrigin
	Evidence EvidenceLevel
}

// SourceEvidence records which bytes a view compiled and how they relate to
// the requesting buffer. Document is present only for dirty source bytes.
type SourceEvidence struct {
	File string

	Origin SourceOrigin
	// EffectiveSourceHash identifies the bytes compiled for the selected view.
	EffectiveSourceHash string
	// BaseSourceHash is empty only when saved hash evidence is unavailable or a
	// future dirty view contains a new dirty-only file.
	BaseSourceHash string
	// Document is present only when dirty buffer bytes supplied the effective hash.
	Document *DocumentRevision
	// BufferMatch is relative to the document in the current request.
	BufferMatch BufferMatch
}

// Publication is the detached, generation-coherent Store payload.
type Publication = readmodel.Publication

// ProjectIndexView combines one atomic publication with its request-relative
// identity and per-source evidence. All maps and slices are detached.
type ProjectIndexView struct {
	Stamp       ViewStamp
	Publication Publication
	Sources     map[string]SourceEvidence
}

// ViewSelection reports an exact view, saved fallback, or unavailability.
// View is non-nil only for selectable results.
type ViewSelection struct {
	Status ViewStatus
	// View is non-nil for exact and saved-fallback selections only.
	View *ProjectIndexView
	// Reason is stable diagnostic metadata and never a feature policy input.
	Reason ViewSelectionReason
}

// ViewProvider selects one coherent view relative to a feature request.
type ViewProvider interface {
	// BestAvailableView returns one detached publication under the request's
	// evidence and freshness policy.
	BestAvailableView(ViewRequest) ViewSelection
}
