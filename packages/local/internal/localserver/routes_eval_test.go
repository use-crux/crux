package localserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/evalwriter"
)

type fakeBaselineWriter struct {
	request evalwriter.SetBaselineRequest
}

func (f *fakeBaselineWriter) SetBaseline(_ context.Context, request evalwriter.SetBaselineRequest) (evalwriter.SetBaselineResult, error) {
	f.request = request
	return evalwriter.SetBaselineResult{RunID: request.RunID, Path: "evals/support.baseline.json"}, nil
}

func TestSetEvalBaselineRouteDelegatesToCoreWriter(t *testing.T) {
	writer := &fakeBaselineWriter{}
	mux := http.NewServeMux()
	registerEvalRoutes(mux, writer)
	request := httptest.NewRequest(http.MethodPost, "/api/eval/baselines", strings.NewReader(`{"runId":"run_0123456789abcdef01234567","variant":"current"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if writer.request.RunID != "run_0123456789abcdef01234567" || writer.request.Variant != "current" {
		t.Fatalf("request = %#v", writer.request)
	}
}

func TestSetEvalBaselineRouteRejectsUnknownFields(t *testing.T) {
	mux := http.NewServeMux()
	registerEvalRoutes(mux, &fakeBaselineWriter{})
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/eval/baselines", strings.NewReader(`{"runId":"run_0123456789abcdef01234567","token":"secret"}`)))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.Code)
	}
}
