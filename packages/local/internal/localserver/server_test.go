package localserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/resourceinspection"
	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestNewUsesItsScopedLoggerForRequestDiagnostics(t *testing.T) {
	var scopedLogs bytes.Buffer
	var defaultLogs bytes.Buffer
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&defaultLogs, nil)))
	t.Cleanup(func() { slog.SetDefault(originalLogger) })

	s := store.NewStore()
	inspectSvc := inspect.NewService(s, inspect.Dir(t.TempDir()))
	devtoolsSvc := devtools.NewService(s, inspectSvc)
	devtoolsSvc.WithProjectIndexer(failingRuntimeOperationIndexer{})
	handler := New(Options{
		Devtools:    devtoolsSvc,
		ProjectRoot: t.TempDir(),
		Logger:      slog.New(slog.NewTextHandler(&scopedLogs, nil)),
	})

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/runtime", nil))

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}
	if got := scopedLogs.String(); !strings.Contains(got, "runtime operation failed") || !strings.Contains(got, "operation=status") {
		t.Fatalf("scoped logs = %q, want runtime operation diagnostic", got)
	}
	if got := defaultLogs.String(); got != "" {
		t.Fatalf("default logs = %q, want scoped logger isolation", got)
	}
}

func TestNewUsesItsScopedLoggerForMountedReadModels(t *testing.T) {
	var scopedLogs bytes.Buffer
	var defaultLogs bytes.Buffer
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&defaultLogs, nil)))
	t.Cleanup(func() { slog.SetDefault(originalLogger) })

	handler := New(Options{
		EvalCatalog: failingEvalCatalog{},
		ProjectRoot: t.TempDir(),
		Logger:      slog.New(slog.NewTextHandler(&scopedLogs, nil)),
	})

	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/eval/catalog", nil))

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusInternalServerError)
	}
	if got := scopedLogs.String(); !strings.Contains(got, "readmodel endpoint failed") || !strings.Contains(got, "route=\"GET /api/eval/catalog\"") {
		t.Fatalf("scoped logs = %q, want readmodel route diagnostic", got)
	}
	if got := defaultLogs.String(); got != "" {
		t.Fatalf("default logs = %q, want scoped logger isolation", got)
	}
}

func TestNewUsesItsScopedLoggerForResponseEncodingFailures(t *testing.T) {
	var scopedLogs bytes.Buffer
	var defaultLogs bytes.Buffer
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&defaultLogs, nil)))
	t.Cleanup(func() { slog.SetDefault(originalLogger) })

	service, err := observability.OpenService(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	handler := New(Options{
		Observability: service,
		Logger:        slog.New(slog.NewTextHandler(&scopedLogs, nil)),
	})
	request := httptest.NewRequest(http.MethodPost, "/api/observability/records", strings.NewReader(`{"schemaVersion":2,"records":[]}`))
	request.Header.Set("Content-Type", "application/json")

	handler.ServeHTTP(&failingResponseWriter{header: make(http.Header)}, request)

	if got := scopedLogs.String(); !strings.Contains(got, "JSON encode error") {
		t.Fatalf("scoped logs = %q, want response encoding diagnostic", got)
	}
	if got := defaultLogs.String(); got != "" {
		t.Fatalf("default logs = %q, want scoped logger isolation", got)
	}
}

func TestNewMountsLocalRuntimeRouteGroups(t *testing.T) {
	ctx := context.Background()
	s := store.NewStore()
	inspectSvc := inspect.NewService(s, inspect.Dir(t.TempDir()))
	devtoolsSvc := devtools.NewService(s, inspectSvc)
	runtimeIndexer := &recordingRuntimeOperationIndexer{}
	devtoolsSvc.WithProjectIndexer(runtimeIndexer)
	observabilitySvc, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = observabilitySvc.Close() })
	runtimeBridge := runtimebridge.NewService(nil)
	handler := New(Options{
		Devtools:           devtoolsSvc,
		Inspect:            inspectSvc,
		Observability:      observabilitySvc,
		RuntimeBridge:      runtimeBridge,
		ResourceInspection: resourceinspection.New(runtimeBridge),
		Hub:                noopHub{},
		ProjectRoot:        "/repo/runtime-routes",
		OriginAllowed:      func(*http.Request) bool { return true },
		SourceResolver: SourceResolverOptions{
			EmbeddedScript: []byte(`console.log("unused in invalid-json route test")`),
		},
	})

	ts := httptest.NewServer(handler)
	t.Cleanup(ts.Close)

	assertStatusAndClose(t, http.MethodGet, ts.URL+"/api/stats", nil, http.StatusOK)
	assertStatusAndClose(t, http.MethodGet, ts.URL+"/api/runtime/bridge/peers", nil, http.StatusOK)
	assertStatusAndClose(t, http.MethodGet, ts.URL+"/api/resources/capabilities", nil, http.StatusOK)
	resp := assertStatus(t, http.MethodGet, ts.URL+"/api/runtime", nil, http.StatusOK)
	var runtimeStatus struct {
		Operation string `json:"operation"`
		OK        bool   `json:"ok"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&runtimeStatus); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if runtimeStatus.Operation != "status" || !runtimeStatus.OK {
		t.Fatalf("runtime status = %+v, want status ok", runtimeStatus)
	}
	if runtimeIndexer.root != "/repo/runtime-routes" || runtimeIndexer.operation != "status" || !runtimeIndexer.includeDetails {
		t.Fatalf("runtime call = %+v, want detailed status for project root", runtimeIndexer)
	}
	assertStatusAndClose(t, http.MethodPost, ts.URL+"/api/observability/records", []byte(`{"schemaVersion":2,"records":[]}`), http.StatusAccepted)
	assertStatusAndClose(t, http.MethodDelete, ts.URL+"/api/inspect/runs", []byte(`{"traceIds":[]}`), http.StatusBadRequest)
	assertStatusAndClose(t, http.MethodPost, ts.URL+"/api/resolve-source", []byte(`{`), http.StatusBadRequest)
	assertStatusAndClose(t, http.MethodGet, ts.URL+"/api/does-not-exist", nil, http.StatusNotFound)

	resp = assertStatus(t, http.MethodPost, ts.URL+"/api/index/snapshot", []byte(`{"schemaVersion":1,"project":{"name":"routes"}}`), http.StatusNoContent)
	resp.Body.Close()

	resp = assertStatus(t, http.MethodGet, ts.URL+"/api/index", nil, http.StatusOK)
	defer resp.Body.Close()
	var index store.IndexData
	if err := json.NewDecoder(resp.Body).Decode(&index); err != nil {
		t.Fatal(err)
	}
	if index.Project == nil || index.Project.Name != "routes" {
		t.Fatalf("index project = %#v, want registered snapshot", index.Project)
	}
}

func assertStatus(t *testing.T, method string, url string, body []byte, want int) *http.Response {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != want {
		resp.Body.Close()
		t.Fatalf("%s %s status = %d, want %d", method, url, resp.StatusCode, want)
	}
	return resp
}

func assertStatusAndClose(t *testing.T, method string, url string, body []byte, want int) {
	t.Helper()
	resp := assertStatus(t, method, url, body, want)
	resp.Body.Close()
}

type noopHub struct{}

func (noopHub) BroadcastJSON(any) {}

func (noopHub) HandleUpgrade(http.ResponseWriter, *http.Request) {}

type failingResponseWriter struct {
	header http.Header
}

func (w *failingResponseWriter) Header() http.Header { return w.header }

func (*failingResponseWriter) Write([]byte) (int, error) {
	return 0, errors.New("response write failed")
}

func (*failingResponseWriter) WriteHeader(int) {}

type recordingRuntimeOperationIndexer struct {
	root           string
	operation      string
	workID         string
	includeDetails bool
}

type failingRuntimeOperationIndexer struct{}

type failingEvalCatalog struct{}

func (failingEvalCatalog) EvalManifests(context.Context) ([]json.RawMessage, error) {
	return nil, errors.New("catalog unavailable")
}

func (failingRuntimeOperationIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, nil
}

func (failingRuntimeOperationIndexer) RunRuntimeOperation(context.Context, string, string, string, bool) (json.RawMessage, error) {
	return nil, errors.New("runtime unavailable")
}

func (i *recordingRuntimeOperationIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, nil
}

func (i *recordingRuntimeOperationIndexer) RunRuntimeOperation(_ context.Context, root, operation, workID string, includeDetails bool) (json.RawMessage, error) {
	i.root = root
	i.operation = operation
	i.workID = workID
	i.includeDetails = includeDetails
	return json.RawMessage(`{"operation":"status","ok":true,"namespace":"local","counts":[],"work":[],"timers":[],"outbox":[]}`), nil
}
