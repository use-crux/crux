// Package view exposes immutable, request-relative PromptText semantic views.
package view

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

// Provider selects one coherent semantic publication and its client-session
// range transforms. Implementations must return detached values.
type Provider interface {
	Select(context.Context, Request) Selection
	Current(Stamp) bool
}

// Request describes one PromptText feature's evidence policy.
type Request struct {
	ScopeID         string
	File            string
	Document        *indexview.DocumentRevision
	MinimumEvidence indexview.EvidenceLevel
	Freshness       indexview.FreshnessPolicy
}

// Selection contains one normalized view when its status is selectable.
type Selection struct {
	Status indexview.ViewStatus
	View   *View
}

// Stamp identifies both the selected Project Index publication and the exact
// client-session transform snapshot used to derive a view.
type Stamp struct {
	Project           indexview.ViewStamp
	TransformRevision uint64
	RequestDocument   *indexview.DocumentRevision
	requestFile       string
}

// DocumentStamp identifies one open document whose transformed records
// contributed to a view.
type DocumentStamp struct {
	File              string
	Revision          indexview.DocumentRevision
	BaseSourceHash    string
	TransformRevision uint64
}

// SourceRefKey is the stable identity of one definition-owned source ref.
type SourceRefKey struct {
	DefinitionID string
	SourceRefID  string
}

// FragmentJoinKey is the stable identity of one proven fragment occurrence.
type FragmentJoinKey struct {
	DefinitionID       string
	OwnerSourceRefID   string
	InterpolationIndex uint32
	TargetSourceRefID  string
}

// Location is a canonical file plus a half-open UTF-16 range.
type Location struct {
	File  string
	Range protocol.Range
}

// PromptTextSourceKind is the compiler-owned semantic reachability class for
// one canonical PromptText source. It must never be inferred from legacy
// source-ref metadata.
type PromptTextSourceKind string

const (
	PromptTextSourceOwner             PromptTextSourceKind = "owner"
	PromptTextSourceNamedFragment     PromptTextSourceKind = "named-fragment"
	PromptTextSourceAnonymousFragment PromptTextSourceKind = "anonymous-fragment"
)

// Definition is the detached subset used by PromptText features.
type Definition struct {
	ID                   string
	Kind                 string
	Name                 string
	Description          string
	Location             Location
	IncomingRelations    int
	OutgoingRelations    int
	PromptTextSourceRefs []SourceRefKey
}

// Site is one existing non-PromptText navigation occurrence.
type Site struct {
	ID                 string
	TargetDefinitionID string
	Role               string
	Location           Location
}

// PromptTextSourceRef is one canonical, semantically resolved template.
type PromptTextSourceRef struct {
	Key        SourceRefKey
	Role       string
	Property   string
	Symbol     string
	Lifecycle  string
	SourceKind PromptTextSourceKind
	Fidelity   string
	Template   Location
}

// FragmentJoin is one semantic-exact named-fragment edge. Its three locations
// are transformed atomically.
type FragmentJoin struct {
	Key            FragmentJoinKey
	OwnerTemplate  Location
	Expression     Location
	TargetTemplate Location
	Proof          string
}

// RefactorBinding is an insertion-ready canonical Core md binding.
type RefactorBinding struct {
	Kind       string
	Expression string
}

// StringRefactorTarget is one manifest-proven ordinary string initializer.
type StringRefactorTarget struct {
	Key        SourceRefKey
	Role       string
	Property   string
	Lifecycle  string
	Expression Location
	Binding    RefactorBinding
	Proof      string
}

// View is one detached, coherently transformed PromptText read model.
type View struct {
	Stamp           Stamp
	Documents       []DocumentStamp
	Definitions     []Definition
	Sites           []Site
	PromptTextRefs  []PromptTextSourceRef
	FragmentJoins   []FragmentJoin
	RefactorTargets []StringRefactorTarget
}
