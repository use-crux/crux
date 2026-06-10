package readmodel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type testDeps struct {
	value string
}

func TestEndpointCallAndHTTPMountShareHandler(t *testing.T) {
	reg := NewRegistry[testDeps]()
	endpoint := Get(
		reg,
		"GET /api/example",
		func(_ context.Context, deps testDeps) (map[string]string, error) {
			return map[string]string{"value": deps.value}, nil
		},
		Alias[testDeps, map[string]string]("GET /api/example-alias"),
	)

	deps := testDeps{value: "same-handler"}
	direct, err := endpoint.Call(context.Background(), deps)
	if err != nil {
		t.Fatalf("direct call: %v", err)
	}
	directJSON, err := json.Marshal(direct)
	if err != nil {
		t.Fatalf("marshal direct response: %v", err)
	}

	mux := http.NewServeMux()
	Mount(mux, deps, reg)
	resp := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/example", nil)
	mux.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", resp.Code, http.StatusOK, resp.Body.String())
	}
	if got, want := resp.Body.String(), string(directJSON)+"\n"; got != want {
		t.Fatalf("HTTP JSON = %q, want %q", got, want)
	}

	aliasResp := httptest.NewRecorder()
	aliasReq := httptest.NewRequest(http.MethodGet, "/api/example-alias", nil)
	mux.ServeHTTP(aliasResp, aliasReq)
	if got, want := aliasResp.Body.String(), resp.Body.String(); got != want {
		t.Fatalf("alias JSON = %q, want %q", got, want)
	}
}

func TestMountMapsReadModelErrorsToHTTPStatus(t *testing.T) {
	reg := NewRegistry[testDeps]()
	Get(reg, "GET /api/missing", func(context.Context, testDeps) (map[string]string, error) {
		return nil, ErrNotFound
	})
	Get(reg, "GET /api/bad", func(context.Context, testDeps) (map[string]string, error) {
		return nil, BadRequest("bad limit")
	})

	mux := http.NewServeMux()
	Mount(mux, testDeps{}, reg)

	tests := []struct {
		path string
		want int
	}{
		{path: "/api/missing", want: http.StatusNotFound},
		{path: "/api/bad", want: http.StatusBadRequest},
	}
	for _, tt := range tests {
		resp := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, tt.path, nil)
		mux.ServeHTTP(resp, req)
		if resp.Code != tt.want {
			t.Fatalf("%s status = %d, want %d", tt.path, resp.Code, tt.want)
		}
	}
}

func TestParameterizedEndpointParsesHTTPPathValues(t *testing.T) {
	reg := NewRegistry[testDeps]()
	endpoint := GetP[testDeps, *PathID, map[string]string](
		reg,
		"GET /api/items/{itemId}",
		func() *PathID { return &PathID{Name: "itemId"} },
		func(_ context.Context, deps testDeps, params *PathID) (map[string]string, error) {
			return map[string]string{"value": deps.value, "itemId": params.ID}, nil
		},
	)

	direct, err := endpoint.Call(context.Background(), testDeps{value: "direct"}, &PathID{ID: "item-direct"})
	if err != nil {
		t.Fatalf("direct call: %v", err)
	}
	if direct["itemId"] != "item-direct" {
		t.Fatalf("direct itemId = %q, want item-direct", direct["itemId"])
	}

	mux := http.NewServeMux()
	Mount(mux, testDeps{value: "http"}, reg)
	resp := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/items/item-http", nil)
	mux.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", resp.Code, http.StatusOK, resp.Body.String())
	}
	var got map[string]string
	if err := json.Unmarshal(resp.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got["itemId"] != "item-http" || got["value"] != "http" {
		t.Fatalf("HTTP response = %+v, want path item and deps value", got)
	}
}

func TestRegistryExposesSnapshotMetadata(t *testing.T) {
	reg := NewRegistry[testDeps]()
	Get(
		reg,
		"GET /api/snapshot-source",
		func(context.Context, testDeps) (map[string]string, error) {
			return map[string]string{"ok": "true"}, nil
		},
		SnapshotAlways[testDeps, map[string]string]("index", ""),
	)
	Get(reg, "GET /api/no-snapshot", func(context.Context, testDeps) (map[string]string, error) {
		return map[string]string{}, nil
	})

	snapshots := reg.Snapshots()
	if len(snapshots) != 1 {
		t.Fatalf("snapshots len = %d, want 1", len(snapshots))
	}
	if snapshots[0].Pattern != "GET /api/snapshot-source" || snapshots[0].Spec.Message != "index" || !snapshots[0].Spec.AlwaysSend {
		t.Fatalf("snapshot metadata = %+v", snapshots[0])
	}
}

func TestRegistryInvalidationMessagesUseEndpointMetadata(t *testing.T) {
	reg := NewRegistry[struct{}]()
	Get(reg, "GET /items", func(context.Context, struct{}) ([]string, error) {
		return []string{"a"}, nil
	}, InvalidatedBy[struct{}, []string](func(event any) (map[string]any, bool) {
		kind, ok := event.(string)
		if !ok || kind != "item.changed" {
			return nil, false
		}
		return map[string]any{"type": "items:changed"}, true
	}))

	messages := reg.InvalidationMessages("item.changed")
	if len(messages) != 1 || messages[0]["type"] != "items:changed" {
		t.Fatalf("messages = %#v, want items:changed", messages)
	}
	if messages := reg.InvalidationMessages("other"); len(messages) != 0 {
		t.Fatalf("messages = %#v, want none", messages)
	}
}
