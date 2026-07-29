package promptpreview

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
	"github.com/use-crux/crux/packages/local/internal/runtimebridge/preview"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestPromptPreviewDiscoveryRouteReturnsOnlyCurrentOwnerAndMatchingChoices(t *testing.T) {
	index := &stubIndexReader{index: store.IndexData{Definitions: []store.ProjectDefinition{
		{ID: "prompt:writer", Kind: "prompt", Name: "Writer", Description: "Writes safely"},
	}}}
	bridge := runtimebridge.NewService(nil)
	bridge.RegisterPeer(runtimebridge.Peer{
		PeerID: "peer-a", RuntimeName: "App", Environment: "node",
		Transport: runtimebridge.TransportWS,
		Capabilities: []runtimebridge.Capability{{
			Command: preview.Command, CatalogueRevision: 4,
			Targets: []preview.Target{
				{
					DefinitionID: "prompt:other", Kind: "prompt", Name: "Private other",
					Input: preview.InputDescriptor{Mode: "none"},
				},
				{
					DefinitionID: "prompt:writer", Kind: "prompt", Name: "Runtime writer",
					Input: preview.InputDescriptor{Mode: "raw"},
				},
			},
		}},
	}, nil)

	mux := http.NewServeMux()
	RegisterRoutes(mux, New(index, bridge))
	request := httptest.NewRequest(
		http.MethodGet, "/api/devtools/prompt-preview/prompt%3Awriter", nil,
	)
	request.Header.Set(RequestHeader, RequestHeaderValue)
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Cache-Control") != "no-store" ||
		recorder.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("privacy headers = %#v", recorder.Header())
	}
	var result Discovery
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "ready" || result.Owner == nil ||
		result.Owner.DefinitionID != "prompt:writer" ||
		len(result.Choices) != 1 {
		t.Fatalf("discovery = %#v", result)
	}
	choice := result.Choices[0]
	if choice.PeerID != "peer-a" || choice.CatalogueRevision != 4 ||
		choice.Target.Name != "Runtime writer" || choice.Target.Input.Mode != "raw" {
		t.Fatalf("choice = %#v", choice)
	}
	encoded := recorder.Body.String()
	for _, forbidden := range []string{"Private other", "endpointUrl", "transport", "capabilities"} {
		if contains(encoded, forbidden) {
			t.Fatalf("response exposed %q: %s", forbidden, encoded)
		}
	}
}

func TestPromptPreviewDiscoveryRouteUsesStableUnavailableReasonsAndProtection(t *testing.T) {
	tests := []struct {
		name       string
		index      store.IndexData
		register   func(*runtimebridge.Service)
		wantReason string
	}{
		{name: "owner missing", wantReason: "owner-not-found"},
		{
			name: "owner is not prompt",
			index: store.IndexData{Definitions: []store.ProjectDefinition{
				{ID: "prompt:writer", Kind: "context", Name: "Writer"},
			}},
			wantReason: "owner-not-prompt",
		},
		{
			name: "no peer",
			index: store.IndexData{Definitions: []store.ProjectDefinition{
				{ID: "prompt:writer", Kind: "prompt", Name: "Writer"},
			}},
			wantReason: "no-peer",
		},
		{
			name: "capability unavailable",
			index: store.IndexData{Definitions: []store.ProjectDefinition{
				{ID: "prompt:writer", Kind: "prompt", Name: "Writer"},
			}},
			register: func(bridge *runtimebridge.Service) {
				bridge.RegisterPeer(runtimebridge.Peer{
					PeerID: "peer", RuntimeName: "App", Environment: "node",
					Transport: runtimebridge.TransportWS,
				}, nil)
			},
			wantReason: "capability-unavailable",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			bridge := runtimebridge.NewService(nil)
			if test.register != nil {
				test.register(bridge)
			}
			mux := http.NewServeMux()
			RegisterRoutes(mux, New(&stubIndexReader{index: test.index}, bridge))
			request := httptest.NewRequest(
				http.MethodGet, "/api/devtools/prompt-preview/prompt%3Awriter", nil,
			)
			request.Header.Set(RequestHeader, RequestHeaderValue)
			recorder := httptest.NewRecorder()
			mux.ServeHTTP(recorder, request)
			var result Discovery
			if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if recorder.Code != http.StatusOK || result.Status != "unavailable" ||
				result.Reason != test.wantReason {
				t.Fatalf("status/result = %d/%#v", recorder.Code, result)
			}
		})
	}

	mux := http.NewServeMux()
	RegisterRoutes(mux, New(&stubIndexReader{}, runtimebridge.NewService(nil)))
	request := httptest.NewRequest(
		http.MethodGet, "/api/devtools/prompt-preview/prompt%3Awriter", nil,
	)
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("missing protection header status = %d, want 403", recorder.Code)
	}

	foreignOrigin := httptest.NewRequest(
		http.MethodGet,
		"http://local.test/api/devtools/prompt-preview/prompt%3Awriter",
		nil,
	)
	foreignOrigin.Header.Set(RequestHeader, RequestHeaderValue)
	foreignOrigin.Header.Set("Origin", "https://local.test")
	recorder = httptest.NewRecorder()
	mux.ServeHTTP(recorder, foreignOrigin)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("foreign discovery Origin status = %d, want 403", recorder.Code)
	}

	preflight := httptest.NewRequest(
		http.MethodOptions,
		"http://local.test/api/devtools/prompt-preview/prompt%3Awriter",
		nil,
	)
	preflight.Header.Set(RequestHeader, RequestHeaderValue)
	recorder = httptest.NewRecorder()
	mux.ServeHTTP(recorder, preflight)
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("discovery preflight status = %d, want 405", recorder.Code)
	}
}

func TestPromptPreviewDiscoveryChoiceLimitIsAllOrNothing(t *testing.T) {
	choices := make([]runtimebridge.PromptPreviewChoice, maxDiscoveryChoices)
	for index := range choices {
		choices[index] = runtimebridge.PromptPreviewChoice{
			PeerID: "peer", RuntimeName: "App", Environment: "node",
			CatalogueRevision: uint64(index + 1),
			Target: preview.Target{
				Name: "Writer", Input: preview.InputDescriptor{Mode: "raw"},
			},
		}
	}
	bridge := &projectionBridge{projection: runtimebridge.PromptPreviewProjection{
		Revision: 1, LivePeerCount: len(choices), PreviewPeerCount: len(choices),
		Choices: choices,
	}}
	service := New(&stubIndexReader{index: store.IndexData{
		Definitions: []store.ProjectDefinition{{
			ID: "prompt:writer", Kind: "prompt", Name: "Writer",
		}},
	}}, bridge)
	if result := service.Discover("prompt:writer"); result.Status != "ready" ||
		len(result.Choices) != maxDiscoveryChoices {
		t.Fatalf("equality discovery = %#v", result)
	}

	bridge.projection.Choices = append(
		bridge.projection.Choices,
		bridge.projection.Choices[0],
	)
	result := service.Discover("prompt:writer")
	if result.Status != "unavailable" ||
		result.Reason != "projection-limit-exceeded" ||
		len(result.Choices) != 0 {
		t.Fatalf("overflow discovery = %#v", result)
	}
}

type projectionBridge struct {
	projection runtimebridge.PromptPreviewProjection
}

func (bridge *projectionBridge) PromptPreviewProjection(
	string,
) runtimebridge.PromptPreviewProjection {
	return bridge.projection
}

func (*projectionBridge) Dispatch(
	context.Context,
	runtimebridge.DispatchRequest,
) (runtimebridge.DispatchResponse, error) {
	panic("discovery attempted runtime dispatch")
}
