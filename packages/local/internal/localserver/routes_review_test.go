package localserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/privacy"
	"github.com/use-crux/crux/packages/local/internal/review"
)

type fakeReviewWriter struct {
	result review.AddCaseResult
	input  review.AddCaseRequest
	err    error
}

func (f *fakeReviewWriter) AddReviewCase(_ context.Context, input review.AddCaseRequest) (review.AddCaseResult, error) {
	f.input = input
	return f.result, f.err
}

func TestReviewPreviewUsesCanonicalProjectorWithoutMutationAndKeepsActionableErrors(t *testing.T) {
	service, err := review.OpenService(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	receipt, err := service.Submit(context.Background(), review.Submission{
		RunID: "run_0123456789abcdef01234567", Rating: "down", DedupeKey: "preview",
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	writer := &fakeReviewWriter{result: review.AddCaseResult{
		Status: "pending-sync", CaseID: "refund", Path: "evals/support.cases.jsonl",
		Row: "{}\n", Diff: "+{}\n",
	}}
	mux := http.NewServeMux()
	registerReviewRoutes(mux, service, writer, true)
	preview := performReviewAction(mux, receipt.ReviewID, []byte(`{"type":"preview-add-to-eval","evalId":"support","caseId":"refund","input":{"question":"refund"},"call":{"tenant":"acme"}}`))
	if preview.Code != http.StatusOK || writer.input.RepositoryWritable {
		t.Fatalf("preview = %d %s, writer input = %#v", preview.Code, preview.Body, writer.input)
	}
	if string(writer.input.Call) != `{"tenant":"acme"}` {
		t.Fatalf("preview lost call context: %s", writer.input.Call)
	}
	projection, _, err := service.Review(context.Background(), receipt.ReviewID)
	if err != nil || projection.Status != "open" {
		t.Fatalf("preview finalized Review: %#v, err = %v", projection, err)
	}

	writer.err = errors.New("Case 'refund' input does not match the managed task schema")
	failed := performReviewAction(mux, receipt.ReviewID, []byte(`{"type":"preview-add-to-eval","evalId":"support","caseId":"refund","input":{}}`))
	if failed.Code != http.StatusBadRequest || !bytes.Contains(failed.Body.Bytes(), []byte("does not match the managed task schema")) {
		t.Fatalf("actionable error = %d %s", failed.Code, failed.Body)
	}

	writer.err = fmt.Errorf("load project privacy policy: %w", privacy.ErrPolicyUnavailable)
	notReady := performReviewAction(mux, receipt.ReviewID, []byte(`{"type":"preview-add-to-eval","evalId":"support","caseId":"refund","input":{}}`))
	if notReady.Code != http.StatusServiceUnavailable || !bytes.Contains(notReady.Body.Bytes(), []byte("crux runtime generate")) {
		t.Fatalf("privacy readiness error = %d %s", notReady.Code, notReady.Body)
	}
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
	registerReviewRoutes(mux, service, writer, false)
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
	if writer.input.RepositoryWritable {
		t.Fatalf("pending-sync projection was incorrectly allowed to write")
	}

	writer.result = review.AddCaseResult{Status: "added", CaseID: "refund", Path: "evals/support.cases.jsonl", Row: "{}\n"}
	writableMux := http.NewServeMux()
	registerReviewRoutes(writableMux, service, writer, true)
	added := performReviewAction(writableMux, receipt.ReviewID, body)
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
		registerReviewRoutes(mux, service, nil, false)
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
