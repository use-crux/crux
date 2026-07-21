package readmodel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestProbeRequiresMatchingProjectRoot(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/index" {
			http.NotFound(response, request)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"projectRoot":"/served","serverVersion":"v1","generation":7,"prompts":[],"contexts":[],"tools":[]}`))
	}))
	defer server.Close()

	client := NewAttachTransport(api.New(server.URL))
	result, err := client.Probe(context.Background(), "/served", "v1", time.Second)
	if err != nil {
		t.Fatalf("matching probe: %v", err)
	}
	if result.VersionSkew || result.Snapshot.Generation == nil || *result.Snapshot.Generation != 7 {
		t.Fatalf("probe result = %#v", result)
	}

	if _, err := client.Probe(context.Background(), "/other", "v1", time.Second); err == nil {
		t.Fatal("mismatched project root probe succeeded")
	}
}

func TestProbeToleratesLegacyMetadataAsVersionSkew(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte(`{"project":{"root":"/repo"},"prompts":[],"contexts":[],"tools":[]}`))
	}))
	defer server.Close()

	result, err := NewAttachTransport(api.New(server.URL)).Probe(context.Background(), "/repo", "v2", time.Second)
	if err != nil {
		t.Fatalf("legacy probe: %v", err)
	}
	if !result.VersionSkew || result.Snapshot.Generation != nil {
		t.Fatalf("legacy probe result = %#v, want version skew with unknown generation", result)
	}
}

func TestProbeHonorsBudgetAndRejectsUndecodableIndex(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		time.Sleep(30 * time.Millisecond)
		_, _ = response.Write([]byte(`not-json`))
	}))
	defer server.Close()

	client := NewAttachTransport(api.New(server.URL))
	if _, err := client.Probe(context.Background(), "/repo", "v1", 5*time.Millisecond); err == nil {
		t.Fatal("timed-out probe succeeded")
	}
}
