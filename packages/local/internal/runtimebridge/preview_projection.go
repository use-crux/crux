package runtimebridge

import (
	"encoding/json"
	"sort"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge/preview"
)

// PromptPreviewChoice is the detached, browser-safe subset of one live
// exact-preview advertisement. It intentionally excludes peer transport,
// endpoint, labels, unrelated capabilities, and unrelated targets.
type PromptPreviewChoice struct {
	PeerID            string
	RuntimeName       string
	Environment       string
	CatalogueRevision uint64
	Target            preview.Target
}

// PromptPreviewProjection is one coherent capture of the private Runtime
// Bridge catalogue state for a single canonical Prompt definition.
type PromptPreviewProjection struct {
	Revision         uint64
	LivePeerCount    int
	PreviewPeerCount int
	Choices          []PromptPreviewChoice
}

// PromptPreviewProjection atomically captures a detached projection for one
// definition. Callers must treat the returned data as immutable.
func (s *Service) PromptPreviewProjection(definitionID string) PromptPreviewProjection {
	s.mu.Lock()
	defer s.mu.Unlock()

	projection := PromptPreviewProjection{
		Revision:      s.previewProjectionRevision,
		LivePeerCount: len(s.peers),
		Choices:       []PromptPreviewChoice{},
	}
	for _, state := range s.peers {
		if state.preview == nil {
			continue
		}
		projection.PreviewPeerCount++
		target, found := findPreviewTarget(state.preview, definitionID)
		if !found {
			continue
		}
		projection.Choices = append(projection.Choices, PromptPreviewChoice{
			PeerID:            state.peer.PeerID,
			RuntimeName:       state.peer.RuntimeName,
			Environment:       state.peer.Environment,
			CatalogueRevision: state.preview.CatalogueRevision,
			Target:            clonePreviewTarget(target),
		})
	}
	sort.Slice(projection.Choices, func(i, j int) bool {
		left, right := projection.Choices[i], projection.Choices[j]
		if left.PeerID != right.PeerID {
			return left.PeerID < right.PeerID
		}
		if left.Environment != right.Environment {
			return left.Environment < right.Environment
		}
		return left.CatalogueRevision < right.CatalogueRevision
	})
	return projection
}

// PromptPreviewProjectionRevision returns the current Local-only publication
// identity without exposing catalogue or target state.
func (s *Service) PromptPreviewProjectionRevision() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.previewProjectionRevision
}

// HasPromptPreviewTarget reports only whether one current live,
// preview-capable peer advertises definitionID. It performs no dispatch and
// exposes none of the matching peer or catalogue state.
func (s *Service) HasPromptPreviewTarget(definitionID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, state := range s.peers {
		if state.preview == nil {
			continue
		}
		if _, found := findPreviewTarget(state.preview, definitionID); found {
			return true
		}
	}
	return false
}

func (s *Service) bumpPreviewProjectionRevisionLocked() {
	if s.previewProjectionRevision >= preview.MaxSafeInteger {
		panic("runtime bridge prompt-preview projection revision exhausted")
	}
	s.previewProjectionRevision++
}

func clonePreviewTarget(target preview.Target) preview.Target {
	if target.Input.Schema == nil {
		return target
	}
	encoded, err := json.Marshal(target.Input.Schema)
	if err != nil {
		panic("validated prompt-preview schema cannot be encoded")
	}
	target.Input.Schema = nil
	if err := json.Unmarshal(encoded, &target.Input.Schema); err != nil {
		panic("validated prompt-preview schema cannot be decoded")
	}
	return target
}
