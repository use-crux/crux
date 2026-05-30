package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/cli/internal/runtimebridge"
)

func TestDiscoverRuntimeBridgeURLsReadsConvexSiteEnvFile(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".env.local"), []byte("CONVEX_SITE_URL=https://project.convex.site\n"), 0o644); err != nil {
		t.Fatalf("write env: %v", err)
	}

	urls := discoverRuntimeBridgeURLs(root)
	if len(urls) != 1 || urls[0] != "https://project.convex.site/crux/bridge" {
		t.Fatalf("urls = %#v", urls)
	}
}

func TestDiscoverRuntimeBridgeURLsDerivesConvexSiteFromCloudURL(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".env.local"), []byte("CONVEX_URL=https://moonlit-stoat-265.convex.cloud\n"), 0o644); err != nil {
		t.Fatalf("write env: %v", err)
	}

	urls := discoverRuntimeBridgeURLs(root)
	if len(urls) != 1 || urls[0] != "https://moonlit-stoat-265.convex.site/crux/bridge" {
		t.Fatalf("urls = %#v", urls)
	}
}

func TestRegisterHTTPRuntimeBridgePeerFetchesManifestAndRegistersPeer(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/crux/bridge", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"enabled":     true,
			"transport":   "http",
			"url":         "https://project.convex.site/crux/bridge",
			"runtimeName": "karyla-convex",
			"environment": "convex",
			"capabilities": []map[string]any{
				{
					"command": "store.read",
					"resources": []map[string]any{
						{"resource": "crux.store", "operations": []string{"get", "list"}},
					},
				},
			},
		})
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	bridge := runtimebridge.NewService(ts.Client())
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := registerHTTPRuntimeBridgePeer(ctx, bridge, ts.URL+"/crux/bridge"); err != nil {
		t.Fatalf("register peer: %v", err)
	}
	peers := bridge.Peers()
	if len(peers) != 1 {
		t.Fatalf("peers = %#v", peers)
	}
	if peers[0].Transport != runtimebridge.TransportHTTP || peers[0].Environment != "convex" {
		t.Fatalf("peer = %#v", peers[0])
	}
	if peers[0].EndpointURL != "https://project.convex.site/crux/bridge" {
		t.Fatalf("endpoint = %q", peers[0].EndpointURL)
	}
}
