package runtimebridge

import (
	"bytes"
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge/preview"
)

func TestPromptPreviewProjectionIsDetachedSortedAndRevisioned(t *testing.T) {
	service := NewService(nil)
	initialRevision := service.PromptPreviewProjection("prompt:writer").Revision

	service.RegisterPeer(Peer{
		PeerID: "z", RuntimeName: "Zed", Environment: "node", Transport: TransportWS,
		Capabilities: []Capability{previewCapability(7,
			preview.Target{
				DefinitionID: "prompt:other", Kind: "prompt", Name: "Other",
				Input: preview.InputDescriptor{Mode: "none"},
			},
			preview.Target{
				DefinitionID: "prompt:writer", Kind: "prompt", Name: "Writer",
				Input: preview.InputDescriptor{Mode: "raw"},
			},
		)},
	}, nil)
	service.RegisterPeer(Peer{
		PeerID: "a", RuntimeName: "Alpha", Environment: "browser", Transport: TransportWS,
		Capabilities: []Capability{previewCapability(3, preview.Target{
			DefinitionID: "prompt:writer", Kind: "prompt", Name: "Writer",
			Input: preview.InputDescriptor{
				Mode: "schema",
				Schema: map[string]any{
					"type":       "object",
					"properties": map[string]any{"name": map[string]any{"type": "string"}},
				},
			},
		})},
	}, nil)

	projection := service.PromptPreviewProjection("prompt:writer")
	if projection.Revision != initialRevision+2 {
		t.Fatalf("revision = %d, want %d", projection.Revision, initialRevision+2)
	}
	if projection.LivePeerCount != 2 || projection.PreviewPeerCount != 2 {
		t.Fatalf("peer counts = %d/%d, want 2/2", projection.LivePeerCount, projection.PreviewPeerCount)
	}
	if len(projection.Choices) != 2 ||
		projection.Choices[0].PeerID != "a" ||
		projection.Choices[1].PeerID != "z" {
		t.Fatalf("choices = %#v, want code-point peer order", projection.Choices)
	}

	projection.Choices[0].Target.Input.Schema["type"] = "changed"
	again := service.PromptPreviewProjection("prompt:writer")
	if again.Choices[0].Target.Input.Schema["type"] != "object" {
		t.Fatal("projection schema mutation escaped into private bridge state")
	}

	service.ReplacePeerManifest("a", Peer{
		RuntimeName: "Alpha", Environment: "browser", Transport: TransportWS,
		Capabilities: []Capability{previewCapability(4, preview.Target{
			DefinitionID: "prompt:writer", Kind: "prompt", Name: "Writer",
			Input: preview.InputDescriptor{Mode: "none"},
		})},
	})
	afterReplacement := service.PromptPreviewProjection("prompt:writer")
	if afterReplacement.Revision != projection.Revision+1 ||
		afterReplacement.Choices[0].CatalogueRevision != 4 {
		t.Fatalf("replacement projection = %#v", afterReplacement)
	}

	service.UnregisterPeer("a")
	if got := service.PromptPreviewProjection("prompt:writer").Revision; got != afterReplacement.Revision+1 {
		t.Fatalf("disconnect revision = %d, want %d", got, afterReplacement.Revision+1)
	}
}

func TestPromptPreviewProjectionRevisionStaysOutOfGenericBridgeEvents(t *testing.T) {
	encoded, err := json.Marshal(Event{
		Type: "runtime_bridge:event", Action: "peer.connected",
		PreviewProjectionRevision: 7,
	})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encoded, []byte("previewProjectionRevision")) {
		t.Fatalf("generic event exposed private projection revision: %s", encoded)
	}
}

func TestHasPromptPreviewTargetIsAPurePrivatePredicate(t *testing.T) {
	service := NewService(nil)
	var sends atomic.Int64
	service.RegisterPeer(Peer{
		PeerID: "peer-a", RuntimeName: "Runtime", Environment: "node",
		Transport: TransportWS,
		Capabilities: []Capability{previewCapability(1, preview.Target{
			DefinitionID: "prompt:greeting", Kind: "prompt", Name: "Greeting",
			Input: preview.InputDescriptor{Mode: "none"},
		})},
	}, func(context.Context, []byte) error {
		sends.Add(1)
		return nil
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := service.Subscribe(ctx)

	if !service.HasPromptPreviewTarget("prompt:greeting") {
		t.Fatal("expected current exact-preview target to be available")
	}
	if service.HasPromptPreviewTarget("prompt:other") {
		t.Fatal("unexpected exact-preview target availability")
	}
	if sends.Load() != 0 {
		t.Fatalf("predicate dispatched %d commands", sends.Load())
	}
	select {
	case event := <-events:
		t.Fatalf("predicate published event %+v", event)
	case <-time.After(20 * time.Millisecond):
	}
}

func previewCapability(revision uint64, targets ...preview.Target) Capability {
	return Capability{
		Command: preview.Command, CatalogueRevision: revision, Targets: targets,
	}
}
