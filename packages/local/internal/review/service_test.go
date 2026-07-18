package review

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/privacy"
)

func TestServiceSubmitPreservesHistoryAndDeduplicatesRetries(t *testing.T) {
	service, err := OpenService(context.Background(), filepath.Join(t.TempDir(), "review.sqlite"))
	if err != nil {
		t.Fatalf("open review service: %v", err)
	}
	t.Cleanup(func() { _ = service.Close() })

	first, err := service.Submit(context.Background(), Submission{
		RunID:   "run_0123456789abcdef01234567",
		Rating:  "down",
		Comment: "needs work",
	}, false)
	if err != nil {
		t.Fatalf("submit first feedback: %v", err)
	}
	if first.Status != "created" || first.Revision != 1 {
		t.Fatalf("first receipt = %#v, want created revision 1", first)
	}

	duplicate, err := service.Submit(context.Background(), Submission{
		RunID:   "run_0123456789abcdef01234567",
		Rating:  "down",
		Comment: "needs work",
	}, false)
	if err != nil {
		t.Fatalf("submit duplicate feedback: %v", err)
	}
	if duplicate.Status != "duplicate" || duplicate.FeedbackID != first.FeedbackID || duplicate.Revision != 1 {
		t.Fatalf("duplicate receipt = %#v, want same feedback at revision 1", duplicate)
	}
	if duplicate.AcceptedAt != first.AcceptedAt {
		t.Fatalf("duplicate acceptedAt = %q, want original %q", duplicate.AcceptedAt, first.AcceptedAt)
	}

	updated, err := service.Submit(context.Background(), Submission{
		RunID:   "run_0123456789abcdef01234567",
		Rating:  "up",
		Comment: "fixed",
	}, false)
	if err != nil {
		t.Fatalf("submit changed feedback: %v", err)
	}
	if updated.Status != "updated" || updated.Revision != 2 || updated.FeedbackID == first.FeedbackID {
		t.Fatalf("updated receipt = %#v, want new feedback at revision 2", updated)
	}

	projection, history, err := service.Review(context.Background(), first.ReviewID)
	if err != nil {
		t.Fatalf("read review: %v", err)
	}
	if projection.ContextStatus != "pending" || projection.Rating != "up" || len(history) != 2 {
		t.Fatalf("projection/history = %#v / %#v", projection, history)
	}

	if err := service.ReconcileRun(context.Background(), projection.RunID); err != nil {
		t.Fatalf("reconcile run: %v", err)
	}
	projection, _, err = service.Review(context.Background(), first.ReviewID)
	if err != nil {
		t.Fatalf("read reconciled review: %v", err)
	}
	if projection.ContextStatus != "linked" {
		t.Fatalf("context status = %q, want linked", projection.ContextStatus)
	}
}

func TestServiceAppliesProjectPolicyToFeedbackAndReviewContext(t *testing.T) {
	service, err := OpenService(
		context.Background(),
		filepath.Join(t.TempDir(), "review.sqlite"),
		WithPrivacyProvider(privacy.Static("customer.email")),
	)
	if err != nil {
		t.Fatalf("open review service: %v", err)
	}
	t.Cleanup(func() { _ = service.Close() })

	receipt, err := service.Submit(context.Background(), Submission{
		RunID:      "run_0123456789abcdef01234567",
		Rating:     "down",
		Correction: json.RawMessage(`{"customer":{"email":"private@example.test","id":"c-1"}}`),
	}, true)
	if err != nil {
		t.Fatalf("submit feedback: %v", err)
	}
	if err := service.LinkRunContext(context.Background(), ContextSnapshot{
		RunID:  "run_0123456789abcdef01234567",
		Input:  json.RawMessage(`{"customer":{"email":"private@example.test","id":"c-1"}}`),
		Output: json.RawMessage(`{"token":"private","answer":"safe"}`),
	}); err != nil {
		t.Fatalf("link context: %v", err)
	}

	projection, history, err := service.Review(context.Background(), receipt.ReviewID)
	if err != nil {
		t.Fatalf("read review: %v", err)
	}
	if string(projection.Correction) != `{"customer":{"email":"[redacted]","id":"c-1"}}` {
		t.Fatalf("correction = %s", projection.Correction)
	}
	if len(history) != 1 || string(history[0].Correction) != string(projection.Correction) {
		t.Fatalf("history = %#v", history)
	}
	if bytes := string(projection.Context); strings.Contains(bytes, "private@example.test") || strings.Contains(bytes, `"token":"private"`) {
		t.Fatalf("context retained private values: %s", bytes)
	}
}
