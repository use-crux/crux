package localserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/evalrunner"
	"github.com/use-crux/crux/packages/local/internal/evalwriter"
)

type fakeBaselineWriter struct {
	request evalwriter.SetBaselineRequest
}

type fakeEvalRunner struct {
	request evalrunner.RunRequest
}

func (f *fakeEvalRunner) Run(_ context.Context, request evalrunner.RunRequest) (evalrunner.RunResult, error) {
	f.request = request
	return evalrunner.RunResult{
		EvalID:   request.EvalID,
		RunID:    "evalrun_0123456789abcdef01234567",
		RunIDs:   []string{"evalrun_0123456789abcdef01234567"},
		ExitCode: 0,
		Passed:   true,
	}, nil
}

func (f *fakeBaselineWriter) SetBaseline(_ context.Context, request evalwriter.SetBaselineRequest) (evalwriter.SetBaselineResult, error) {
	f.request = request
	return evalwriter.SetBaselineResult{RunID: request.RunID, Path: "evals/support.baseline.json"}, nil
}

func TestSetEvalBaselineRouteDelegatesToCoreWriter(t *testing.T) {
	writer := &fakeBaselineWriter{}
	mux := http.NewServeMux()
	registerEvalRoutes(mux, writer, nil)
	request := httptest.NewRequest(http.MethodPost, "/api/eval/baselines", strings.NewReader(`{"runId":"run_0123456789abcdef01234567","variant":"current","acceptFailing":true}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if writer.request.RunID != "run_0123456789abcdef01234567" || writer.request.Variant != "current" || !writer.request.AcceptFailing {
		t.Fatalf("request = %#v", writer.request)
	}
}

func TestSetEvalBaselineRouteRejectsUnknownFields(t *testing.T) {
	mux := http.NewServeMux()
	registerEvalRoutes(mux, &fakeBaselineWriter{}, nil)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/eval/baselines", strings.NewReader(`{"runId":"run_0123456789abcdef01234567","token":"secret"}`)))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.Code)
	}
}

func TestRunEvalRouteDelegatesToCoordinatorWithExplicitCostConfirmation(t *testing.T) {
	runner := &fakeEvalRunner{}
	mux := http.NewServeMux()
	registerEvalRoutes(mux, nil, runner)
	request := httptest.NewRequest(http.MethodPost, "/api/eval/runs", strings.NewReader(`{"evalId":"support","confirmUnknownCost":true}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if runner.request.EvalID != "support" || !runner.request.ConfirmUnknownCost {
		t.Fatalf("request = %#v", runner.request)
	}
	if !strings.Contains(response.Body.String(), `"runId":"evalrun_0123456789abcdef01234567"`) {
		t.Fatalf("body = %s", response.Body.String())
	}
}

func TestRunEvalRouteRejectsUnknownFieldsWithoutStartingCoordinator(t *testing.T) {
	runner := &fakeEvalRunner{}
	mux := http.NewServeMux()
	registerEvalRoutes(mux, nil, runner)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/eval/runs", strings.NewReader(`{"evalId":"support","token":"secret"}`)))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.Code)
	}
	if runner.request.EvalID != "" {
		t.Fatalf("runner was called with %#v", runner.request)
	}
}

func TestRunEvalRouteRejectsCLIFlagSelectors(t *testing.T) {
	runner := &fakeEvalRunner{}
	mux := http.NewServeMux()
	registerEvalRoutes(mux, nil, runner)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/eval/runs", strings.NewReader(`{"evalId":"--fresh","confirmUnknownCost":true}`)))

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.Code)
	}
	if runner.request.EvalID != "" {
		t.Fatalf("runner was called with %#v", runner.request)
	}
}
