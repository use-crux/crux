package quality

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

// TestQualityCorrelationDoesNotFallBackToRunIDWhenTraceIDHasNoMatch is a
// regression test for binding spec 04 §3: Quality joins must use one
// explicit, deterministic correlation key, not an accidental assumption that
// one subsystem's traceId equals another subsystem's runId. Previously the
// join tried metadata keyed by TraceID, and whenever that simply had no
// entry it unconditionally retried the same lookup keyed by RunID — so an
// unrelated run whose RunID collided with this run's TraceID could leak
// feedback/experiment/score data onto the wrong run.
func TestQualityCorrelationDoesNotFallBackToRunIDWhenTraceIDHasNoMatch(t *testing.T) {
	metadata := qualityObservabilityMetadata{
		feedbackByTrace: map[string][]string{
			// Keyed by an unrelated run's RunID, which happens to collide
			// with this run's TraceID's *value space* only coincidentally.
			"run_unrelated_collider": {"feedback_from_a_different_run"},
		},
	}
	summary := observability.RunSummary{
		RunID:   "run_unrelated_collider",
		TraceID: "trace_with_no_feedback",
	}

	run := metadata.apply(qualityRunRecord{}, summary)

	if len(run.FeedbackIDs) != 0 {
		t.Fatalf("feedbackIDs = %#v, want none: RunID must not be tried once TraceID is present but unmatched", run.FeedbackIDs)
	}
}

func TestQualityCorrelationFallsBackToRunIDOnlyWhenTraceIDIsEmpty(t *testing.T) {
	metadata := qualityObservabilityMetadata{
		feedbackByTrace: map[string][]string{
			"run_no_trace": {"feedback_by_run_id"},
		},
	}
	summary := observability.RunSummary{
		RunID:   "run_no_trace",
		TraceID: "",
	}

	run := metadata.apply(qualityRunRecord{}, summary)

	if len(run.FeedbackIDs) != 1 || run.FeedbackIDs[0] != "feedback_by_run_id" {
		t.Fatalf("feedbackIDs = %#v, want RunID-keyed feedback when TraceID is empty", run.FeedbackIDs)
	}
}

func TestQualityCorrelationUsesTraceIDWhenPresent(t *testing.T) {
	metadata := qualityObservabilityMetadata{
		feedbackByTrace: map[string][]string{
			"trace_a": {"feedback_by_trace"},
			"run_a":   {"feedback_by_run_id_should_not_be_used"},
		},
	}
	summary := observability.RunSummary{RunID: "run_a", TraceID: "trace_a"}

	run := metadata.apply(qualityRunRecord{}, summary)

	if len(run.FeedbackIDs) != 1 || run.FeedbackIDs[0] != "feedback_by_trace" {
		t.Fatalf("feedbackIDs = %#v, want trace-keyed feedback preferred over run-id-keyed", run.FeedbackIDs)
	}
}
