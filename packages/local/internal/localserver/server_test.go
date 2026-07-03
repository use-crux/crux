package localserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/resourceinspection"
	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestNewMountsLocalRuntimeRouteGroups(t *testing.T) {
	ctx := context.Background()
	s := store.NewStore()
	qualitySvc := quality.NewService(s, quality.Dir(t.TempDir()))
	devtoolsSvc := devtools.NewService(s, qualitySvc)
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
		Quality:            qualitySvc,
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
	assertStatusAndClose(t, http.MethodPost, ts.URL+"/api/observability/records", []byte(`{"records":[]}`), http.StatusAccepted)
	assertStatusAndClose(t, http.MethodDelete, ts.URL+"/api/quality/runs", []byte(`{"traceIds":[]}`), http.StatusBadRequest)
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

type recordingRuntimeOperationIndexer struct {
	root           string
	operation      string
	workID         string
	includeDetails bool
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
