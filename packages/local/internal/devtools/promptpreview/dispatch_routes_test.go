package promptpreview

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
	"github.com/use-crux/crux/packages/local/internal/runtimebridge/preview"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestPromptPreviewDispatchRouteRequiresExplicitSameOriginAndStripsBridgeEnvelope(t *testing.T) {
	index := &stubIndexReader{index: store.IndexData{Definitions: []store.ProjectDefinition{
		{ID: "prompt:writer", Kind: "prompt", Name: "Writer"},
	}}}
	bridge := runtimebridge.NewService(nil)
	var sends atomic.Int32
	bridge.RegisterPeer(runtimebridge.Peer{
		PeerID: "peer-a", RuntimeName: "App", Environment: "node",
		Transport: runtimebridge.TransportWS,
		Capabilities: []runtimebridge.Capability{{
			Command: preview.Command, CatalogueRevision: 4,
			Targets: []preview.Target{{
				DefinitionID: "prompt:writer", Kind: "prompt", Name: "Writer",
				Input: preview.InputDescriptor{Mode: "raw"},
			}},
		}},
	}, func(_ context.Context, data []byte) error {
		sends.Add(1)
		var request struct {
			CommandID string `json:"commandId"`
		}
		if err := json.Unmarshal(data, &request); err != nil {
			return err
		}
		response := fmt.Sprintf(`{
			"type":"command.result",
			"commandId":%q,
			"result":{
				"status":"ready",
				"targetId":"prompt:writer",
				"catalogueRevision":4,
				"inspection":{
					"system":{"text":"","tokens":0,"coverage":"complete","parts":[]},
					"totalTokens":0,
					"droppedContexts":[],
					"excludedContexts":[]
				}
			}
		}`, request.CommandID)
		go func() {
			_ = bridge.HandlePeerMessage("peer-a", []byte(response))
		}()
		return nil
	})

	mux := http.NewServeMux()
	RegisterRoutes(mux, New(index, bridge))
	body := `{
		"version":1,
		"definitionId":"prompt:writer",
		"peerId":"peer-a",
		"environment":"node",
		"catalogueRevision":4,
		"payload":{"input":{"customer":"Ada"}}
	}`
	request := httptest.NewRequest(
		http.MethodPost, "http://local.test/api/devtools/prompt-preview",
		strings.NewReader(body),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://local.test")
	request.Header.Set(RequestHeader, RequestHeaderValue)
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var result BrowserResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "ready" || result.Peer == nil ||
		result.Peer.PeerID != "peer-a" || result.Peer.RuntimeName != "App" ||
		result.CatalogueRevision != 4 {
		t.Fatalf("result = %#v", result)
	}
	for _, forbidden := range []string{"commandId", "targetId", "runIds", "traceIds"} {
		if contains(recorder.Body.String(), forbidden) {
			t.Fatalf("response exposed %q: %s", forbidden, recorder.Body.String())
		}
	}
	if sends.Load() != 1 {
		t.Fatalf("dispatch sends = %d, want 1", sends.Load())
	}

	withoutOrigin := httptest.NewRequest(
		http.MethodPost, "http://local.test/api/devtools/prompt-preview",
		strings.NewReader(body),
	)
	withoutOrigin.Header.Set("Content-Type", "application/json")
	withoutOrigin.Header.Set(RequestHeader, RequestHeaderValue)
	blocked := httptest.NewRecorder()
	mux.ServeHTTP(blocked, withoutOrigin)
	if blocked.Code != http.StatusForbidden || sends.Load() != 1 {
		t.Fatalf("missing Origin = %d sends=%d", blocked.Code, sends.Load())
	}

	for _, origin := range []string{
		"https://local.test",
		"http://user@local.test",
		"http://local.test/path",
		"http://foreign.test",
	} {
		t.Run(origin, func(t *testing.T) {
			foreign := httptest.NewRequest(
				http.MethodPost,
				"http://local.test/api/devtools/prompt-preview",
				strings.NewReader(body),
			)
			foreign.Header.Set("Content-Type", "application/json")
			foreign.Header.Set("Origin", origin)
			foreign.Header.Set(RequestHeader, RequestHeaderValue)
			rejected := httptest.NewRecorder()
			mux.ServeHTTP(rejected, foreign)
			if rejected.Code != http.StatusForbidden || sends.Load() != 1 {
				t.Fatalf("origin %q = %d sends=%d", origin, rejected.Code, sends.Load())
			}
		})
	}

	duplicateOrigin := httptest.NewRequest(
		http.MethodPost,
		"http://local.test/api/devtools/prompt-preview",
		strings.NewReader(body),
	)
	duplicateOrigin.Header.Set("Content-Type", "application/json")
	duplicateOrigin.Header.Add("Origin", "http://local.test")
	duplicateOrigin.Header.Add("Origin", "http://local.test")
	duplicateOrigin.Header.Set(RequestHeader, RequestHeaderValue)
	rejected := httptest.NewRecorder()
	mux.ServeHTTP(rejected, duplicateOrigin)
	if rejected.Code != http.StatusForbidden || sends.Load() != 1 {
		t.Fatalf("duplicate Origin = %d sends=%d", rejected.Code, sends.Load())
	}

	duplicateProtection := httptest.NewRequest(
		http.MethodPost,
		"http://local.test/api/devtools/prompt-preview",
		strings.NewReader(body),
	)
	duplicateProtection.Header.Set("Content-Type", "application/json")
	duplicateProtection.Header.Set("Origin", "http://local.test")
	duplicateProtection.Header.Add(RequestHeader, RequestHeaderValue)
	duplicateProtection.Header.Add(RequestHeader, RequestHeaderValue)
	rejected = httptest.NewRecorder()
	mux.ServeHTTP(rejected, duplicateProtection)
	if rejected.Code != http.StatusForbidden || sends.Load() != 1 {
		t.Fatalf(
			"duplicate protection header = %d sends=%d",
			rejected.Code,
			sends.Load(),
		)
	}
}

func TestPromptPreviewDispatchRouteRejectsDuplicateFieldsBeforeRuntimeSend(t *testing.T) {
	bridge := runtimebridge.NewService(nil)
	mux := http.NewServeMux()
	RegisterRoutes(mux, New(&stubIndexReader{}, bridge))
	request := httptest.NewRequest(
		http.MethodPost, "http://local.test/api/devtools/prompt-preview",
		strings.NewReader(`{
			"version":1,
			"version":1,
			"definitionId":"prompt:writer",
			"peerId":"peer",
			"environment":"node",
			"catalogueRevision":1,
			"payload":{"input":{}}
		}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://local.test")
	request.Header.Set(RequestHeader, RequestHeaderValue)
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, request)
	var result BrowserResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if recorder.Code != http.StatusBadRequest ||
		result.Status != "error" || result.Code != "invalid_request" {
		t.Fatalf("status/result = %d/%#v", recorder.Code, result)
	}
}

type stubIndexReader struct {
	index store.IndexData
}

func (reader *stubIndexReader) ProjectIndexSnapshot() store.IndexData {
	return reader.index
}

func contains(value, fragment string) bool {
	for index := 0; index+len(fragment) <= len(value); index++ {
		if value[index:index+len(fragment)] == fragment {
			return true
		}
	}
	return false
}
