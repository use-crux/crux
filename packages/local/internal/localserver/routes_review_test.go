package localserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/review"
)

type fakeReviewWriter struct {
	result review.AddCaseResult
	input  review.AddCaseRequest
}

func (f *fakeReviewWriter) AddReviewCase(_ context.Context, input review.AddCaseRequest) (review.AddCaseResult, error) {
	f.input = input
	return f.result, nil
}

func TestReviewActionsOnlyFinalizeAfterRepositoryWriterConfirmation(t *testing.T) {
	service, err := review.OpenService(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	receipt, err := service.Submit(context.Background(), review.Submission{
		RunID: "run_0123456789abcdef01234567", Rating: "down",
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	writer := &fakeReviewWriter{result: review.AddCaseResult{
		Status: "pending-sync", CaseID: "refund", Path: "evals/support.cases.jsonl", Row: "{}\n",
	}}
	mux := http.NewServeMux()
	registerReviewRoutes(mux, service, writer)
	body := []byte(`{"type":"add-to-eval","evalId":"support","caseId":"refund","input":{"question":"refund"},"correctionProposal":"approved","saveCorrection":true}`)

	pending := performReviewAction(mux, receipt.ReviewID, body)
	if pending.Code != http.StatusOK {
		t.Fatalf("pending status = %d: %s", pending.Code, pending.Body.String())
	}
	projection, _, err := service.Review(context.Background(), receipt.ReviewID)
	if err != nil || projection.Status != "open" {
		t.Fatalf("pending projection = %#v, err = %v", projection, err)
	}
	if writer.input.RunID != "run_0123456789abcdef01234567" || !writer.input.SaveCorrection {
		t.Fatalf("writer input = %#v", writer.input)
	}

	writer.result = review.AddCaseResult{Status: "added", CaseID: "refund", Path: "evals/support.cases.jsonl", Row: "{}\n"}
	added := performReviewAction(mux, receipt.ReviewID, body)
	if added.Code != http.StatusOK {
		t.Fatalf("added status = %d: %s", added.Code, added.Body.String())
	}
	projection, _, err = service.Review(context.Background(), receipt.ReviewID)
	if err != nil || projection.Status != "added-to-eval" || projection.TargetCaseID != "refund" {
		t.Fatalf("added projection = %#v, err = %v", projection, err)
	}
}

func TestReviewResolveAppendsThroughExactActionRoute(t *testing.T) {
	service, err := review.OpenService(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	receipt, err := service.Submit(context.Background(), review.Submission{
		RunID: "run_0123456789abcdef01234567", Rating: "up", DedupeKey: "resolve",
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	response := performReviewAction(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mux := http.NewServeMux()
		registerReviewRoutes(mux, service, nil)
		mux.ServeHTTP(w, r)
	}), receipt.ReviewID, []byte(`{"type":"resolve"}`))
	if response.Code != http.StatusOK {
		t.Fatalf("resolve status = %d: %s", response.Code, response.Body.String())
	}
	var projection review.Projection
	if err := json.NewDecoder(response.Body).Decode(&projection); err != nil || projection.Status != "resolved" {
		t.Fatalf("resolve projection = %#v, err = %v", projection, err)
	}
}

func performReviewAction(handler http.Handler, reviewID string, body []byte) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/api/reviews/"+reviewID+"/actions", bytes.NewReader(body))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
