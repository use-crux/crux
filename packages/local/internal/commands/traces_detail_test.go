package commands

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func TestShowTraceDetailAcceptsRunOrTraceID(t *testing.T) {
	const (
		runID   = "run-support"
		traceID = "11111111111111111111111111111111"
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/observability/runs/" + traceID:
			http.NotFound(w, r)
		case "/api/observability/runs/page":
			_, _ = w.Write([]byte(`{"revision":1,"rows":[{"runId":"` + runID + `","traceId":"` + traceID + `"}]}`))
		case "/api/observability/runs/" + runID:
			_, _ = w.Write([]byte(`{"run":{"runId":"` + runID + `","traceId":"` + traceID + `","status":"ok"}}`))
		default:
			t.Fatalf("unexpected request path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	for _, id := range []string{runID, traceID} {
		t.Run(id, func(t *testing.T) {
			var out, errOut bytes.Buffer
			streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
			if err := showTraceDetail(streams, context.Background(), api.New(server.URL), id, true); err != nil {
				t.Fatalf("showTraceDetail(%q): %v", id, err)
			}
			if !strings.Contains(out.String(), runID) || !strings.Contains(out.String(), traceID) {
				t.Fatalf("detail output = %q, want run and trace IDs", out.String())
			}
		})
	}
}

func TestShowTraceDetailNotFoundNamesAcceptedIdentifiers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/observability/runs/page" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"revision":1,"rows":[]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	var out, errOut bytes.Buffer
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
	err := showTraceDetail(streams, context.Background(), api.New(server.URL), "missing", false)
	if err == nil || err.Error() != `trace "missing" not found; expected a run ID or trace ID` {
		t.Fatalf("error = %v", err)
	}
}
