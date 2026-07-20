package commands

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/output"
)

type commandFailingWriter struct {
	err error
}

func (w commandFailingWriter) Write([]byte) (int, error) {
	return 0, w.err
}

func TestRefreshStatsPropagatesJSONWriteError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/stats" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"totalExecutions": 1}`))
	}))
	defer server.Close()

	want := errors.New("write failed")
	streams := output.NewTestIO(commandFailingWriter{err: want}, &bytes.Buffer{}, output.TestIOOptions{})

	err := refreshStats(context.Background(), api.New(server.URL), streams, true)
	if !errors.Is(err, want) {
		t.Fatalf("refreshStats() error = %v, want errors.Is(_, %v)", err, want)
	}
}

func TestListTracesWritesJSONToInjectedOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/observability/runs/page" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"rows":[{"runId":"run-1"}]}`))
	}))
	defer server.Close()

	var out bytes.Buffer
	streams := output.NewTestIO(&out, &bytes.Buffer{}, output.TestIOOptions{})
	if err := listTraces(streams, context.Background(), api.New(server.URL), "", "", true); err != nil {
		t.Fatalf("listTraces() error = %v", err)
	}
	if got := out.String(); !bytes.Contains(out.Bytes(), []byte(`"runId": "run-1"`)) {
		t.Fatalf("listTraces() output = %q, want injected trace JSON", got)
	}
}

func TestWriteObservabilityRunPropagatesJSONWriteError(t *testing.T) {
	want := errors.New("write failed")
	streams := output.NewTestIO(commandFailingWriter{err: want}, &bytes.Buffer{}, output.TestIOOptions{})

	err := writeObservabilityRun(streams, api.ObservabilityRunSummary{RunID: "run-1"}, true)
	if !errors.Is(err, want) {
		t.Fatalf("writeObservabilityRun() error = %v, want errors.Is(_, %v)", err, want)
	}
}
