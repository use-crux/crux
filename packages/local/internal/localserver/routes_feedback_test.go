package localserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/privacy"
	"github.com/use-crux/crux/packages/local/internal/review"
)

func TestFeedbackRouteIsDurableIdempotentAndReconcilesOutOfOrderRun(t *testing.T) {
	ctx := context.Background()
	reviews, err := review.OpenService(ctx, filepath.Join(t.TempDir(), "review.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reviews.Close() })
	observed, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = observed.Close() })

	mux := http.NewServeMux()
	registerFeedbackRoutes(mux, reviews, observed)
	registerObservabilityRoutesWithReview(mux, observed, nil, nil, reviews)
	body := []byte(`{"runId":"run_0123456789abcdef01234567","rating":"down","comment":"owner@example.com","correction":{"token":"private","answer":"safe"}}`)

	first := performFeedbackRequest(mux, body)
	if first.Code != http.StatusCreated {
		t.Fatalf("first status = %d, body = %s", first.Code, first.Body.String())
	}
	var created review.Receipt
	if err := json.NewDecoder(first.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	duplicate := performFeedbackRequest(mux, body)
	if duplicate.Code != http.StatusOK {
		t.Fatalf("duplicate status = %d, body = %s", duplicate.Code, duplicate.Body.String())
	}
	var repeated review.Receipt
	if err := json.NewDecoder(duplicate.Body).Decode(&repeated); err != nil {
		t.Fatal(err)
	}
	if repeated.Status != "duplicate" || repeated.FeedbackID != created.FeedbackID {
		t.Fatalf("duplicate receipt = %#v, created = %#v", repeated, created)
	}

	projection, history, err := reviews.Review(ctx, created.ReviewID)
	if err != nil {
		t.Fatal(err)
	}
	if projection.ContextStatus != "pending" || projection.Comment != "[redacted-email]" || string(projection.Correction) != `{"answer":"safe","token":"[redacted]"}` || len(history) != 1 {
		t.Fatalf("pending projection/history = %#v / %#v", projection, history)
	}

	ingest := []byte(`{"schemaVersion":5,"records":[{"schemaVersion":5,"recordId":"record-feedback-run","type":"run:start","runId":"run_0123456789abcdef01234567","operationId":"run_0123456789abcdef01234567","segmentId":"segment_feedback_run","segmentSeq":1,"name":"feedback source","rootPrimitive":"generation.call","startedAt":"2026-07-16T20:00:00.000Z","status":"running"}]}`)
	response := performObservabilityIngestRequest(mux, ingest)
	if response.Code != http.StatusAccepted {
		t.Fatalf("ingest status = %d, body = %s", response.Code, response.Body.String())
	}
	projection, _, err = reviews.Review(ctx, created.ReviewID)
	if err != nil {
		t.Fatal(err)
	}
	if projection.ContextStatus != "linked" {
		t.Fatalf("context status = %q, want linked", projection.ContextStatus)
	}
	if !bytes.Contains(projection.Context, []byte(`"name":"feedback source"`)) {
		t.Fatalf("linked context = %s, want bounded run summary", projection.Context)
	}
}

func TestFeedbackRouteFailsClosedUntilGeneratedPrivacyPolicyIsReady(t *testing.T) {
	reviews, err := review.OpenService(
		context.Background(),
		":memory:",
		review.WithPrivacyProvider(privacy.Generated(t.TempDir())),
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reviews.Close() })
	mux := http.NewServeMux()
	registerFeedbackRoutes(mux, reviews, nil)

	response := performFeedbackRequest(mux, []byte(`{"runId":"run_0123456789abcdef01234567","rating":"down"}`))

	if response.Code != http.StatusServiceUnavailable || !bytes.Contains(response.Body.Bytes(), []byte("crux runtime generate")) {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestFeedbackRouteRejectsOversizedBodiesBeforePersistence(t *testing.T) {
	reviews, err := review.OpenService(context.Background(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reviews.Close() })
	mux := http.NewServeMux()
	registerFeedbackRoutes(mux, reviews, nil)
	body := append(
		[]byte(`{"runId":"run_0123456789abcdef01234567","rating":"up","comment":"`),
		bytes.Repeat([]byte("x"), maxFeedbackRequestBytes)...,
	)
	body = append(body, []byte(`"}`)...)

	response := performFeedbackRequest(mux, body)

	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413; body = %s", response.Code, response.Body.String())
	}
}

func performFeedbackRequest(handler http.Handler, body []byte) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/api/feedback", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
