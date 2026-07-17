package review

import (
	"context"
	"path/filepath"
	"testing"
)

func TestReviewActionsAppendHistoryAndRecomputeProjection(t *testing.T) {
	service, err := OpenService(context.Background(), filepath.Join(t.TempDir(), "review.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })

	tests := []struct {
		name       string
		action     Action
		wantStatus string
	}{
		{name: "resolve", action: Action{Type: "resolve"}, wantStatus: "resolved"},
		{name: "dismiss", action: Action{Type: "dismiss"}, wantStatus: "dismissed"},
		{
			name:       "added",
			action:     Action{Type: "added-to-eval", TargetEvalID: "support", TargetCaseID: "refund"},
			wantStatus: "added-to-eval",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			receipt, err := service.Submit(context.Background(), Submission{
				RunID:     "run_0123456789abcdef01234567",
				Rating:    "down",
				DedupeKey: test.name,
			}, false)
			if err != nil {
				t.Fatal(err)
			}
			action := test.action
			action.ReviewID = receipt.ReviewID
			projection, err := service.ApplyAction(context.Background(), action)
			if err != nil {
				t.Fatal(err)
			}
			if projection.Status != test.wantStatus {
				t.Fatalf("status = %q, want %q", projection.Status, test.wantStatus)
			}
			actions, err := service.Actions(context.Background(), receipt.ReviewID)
			if err != nil {
				t.Fatal(err)
			}
			if len(actions) != 1 || actions[0].Type != test.action.Type {
				t.Fatalf("actions = %#v", actions)
			}
		})
	}
}
