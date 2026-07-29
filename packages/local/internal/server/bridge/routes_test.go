package bridge

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
)

func TestCommandRouteReturnsStablePreviewFailureAndChoices(t *testing.T) {
	service := runtimebridge.NewService(nil)
	for _, peerID := range []string{"peer-b", "peer-a"} {
		var capability runtimebridge.Capability
		if err := json.Unmarshal([]byte(`{
			"command":"prompt.previewExact","catalogueRevision":1,
			"targets":[{"definitionId":"prompt:x","kind":"prompt","name":"x","input":{"mode":"none"}}]
		}`), &capability); err != nil {
			t.Fatal(err)
		}
		service.RegisterPeer(runtimebridge.Peer{
			PeerID: peerID, RuntimeName: peerID, Environment: "node",
			Transport:    runtimebridge.TransportWS,
			Capabilities: []runtimebridge.Capability{capability},
		}, nil)
	}
	mux := http.NewServeMux()
	RegisterRoutes(mux, service)
	body := bytes.NewBufferString(`{
		"command":"prompt.previewExact","targetId":"prompt:x",
		"catalogueRevision":1,"payload":{"input":{}}
	}`)
	request := httptest.NewRequest(http.MethodPost, "/api/runtime/bridge/commands", body)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", response.Code)
	}
	var failure struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Choices []struct {
			PeerID string `json:"peerId"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &failure); err != nil {
		t.Fatalf("decode failure: %v; body=%q", err, response.Body.String())
	}
	if failure.Code != "ambiguous_peer" ||
		failure.Message != "Multiple runtime peers can inspect this prompt. Select one and retry." ||
		len(failure.Choices) != 2 ||
		failure.Choices[0].PeerID != "peer-a" ||
		failure.Choices[1].PeerID != "peer-b" {
		t.Fatalf("failure = %#v", failure)
	}
}

func TestCommandRouteRejectsDuplicatePreviewSelectors(t *testing.T) {
	service := runtimebridge.NewService(nil)
	mux := http.NewServeMux()
	RegisterRoutes(mux, service)
	body := bytes.NewBufferString(`{
		"command":"prompt.previewExact",
		"targetId":"prompt:first",
		"targetId":"prompt:second",
		"catalogueRevision":1,
		"payload":{"input":{}}
	}`)
	request := httptest.NewRequest(
		http.MethodPost, "/api/runtime/bridge/commands", body,
	)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	var failure struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &failure); err != nil {
		t.Fatalf("decode failure: %v; body=%q", err, response.Body.String())
	}
	if failure.Code != "invalid_request" {
		t.Fatalf("failure = %#v", failure)
	}
}
