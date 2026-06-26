package quality

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestEvidencePrimaryFrameFallsBackToResolvedPassingAssertionFrame(t *testing.T) {
	frame := api.QualitySourceFrame{
		Kind:         "source-frame",
		SourceRef:    "evals/support.eval.ts:12:5",
		AuthoredFile: "/workspace/evals/support.eval.ts",
		AuthoredLine: 12,
		Resolver:     "disk",
	}

	got := evidencePrimaryFrame([]api.QualityAssertionOutcome{
		{
			ID:          "expect:case:0",
			Status:      "passed",
			SourceRef:   "evals/support.eval.ts:12:5",
			SourceFrame: &frame,
		},
	})

	if got.Kind != "source-frame" || got.AuthoredFile != "/workspace/evals/support.eval.ts" || got.Resolver != "disk" {
		t.Fatalf("primary frame = %+v", got)
	}
}

func TestEvidencePrimaryFrameStillPrefersFailedAssertionFrame(t *testing.T) {
	passedFrame := api.QualitySourceFrame{
		Kind:         "source-frame",
		SourceRef:    "evals/support.eval.ts:12:5",
		AuthoredFile: "/workspace/evals/support.eval.ts",
		AuthoredLine: 12,
		Resolver:     "disk",
	}
	failedFrame := api.QualitySourceFrame{
		Kind:         "source-frame",
		SourceRef:    "evals/support.eval.ts:13:5",
		AuthoredFile: "/workspace/evals/support.eval.ts",
		AuthoredLine: 13,
		Resolver:     "disk",
	}

	got := evidencePrimaryFrame([]api.QualityAssertionOutcome{
		{ID: "expect:case:0", Status: "passed", SourceFrame: &passedFrame},
		{ID: "expect:case:1", Status: "failed", SourceFrame: &failedFrame},
	})

	if got.SourceRef != "evals/support.eval.ts:13:5" {
		t.Fatalf("primary frame = %+v", got)
	}
}
