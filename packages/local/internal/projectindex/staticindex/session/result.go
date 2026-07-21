package session

import (
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/planner"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/run"
)

// Status describes how a Static Index session resolved.
type Status string

const (
	// ReasonEmpty reports a finalize stream that produced no patch decision.
	ReasonEmpty = run.ReasonEmpty
	// ReasonEvidence reports that native analysis needed TypeScript-host evidence.
	ReasonEvidence = run.ReasonEvidence
	// ReasonIncomplete reports a finalize stream with an incomplete patch decision.
	ReasonIncomplete = run.ReasonIncomplete

	// StatusMissingCompiler means planning requested Static Index execution, but
	// no compiler implementation was configured.
	StatusMissingCompiler Status = "missing-compiler"
	// StatusUnschedulable means the plan requires TypeScript compatibility work
	// that the Static Index compiler lane must not attempt.
	StatusUnschedulable Status = "unschedulable"
	// StatusIncomplete means the compiler ran but did not produce a complete
	// Project Index patch.
	StatusIncomplete Status = "incomplete"
	// StatusComplete means the compiler produced a complete Project Index patch.
	StatusComplete Status = "complete"
)

// Result is the complete outcome of one Static Index session.
type Result struct {
	// Status classifies whether Static Index ran, completed, or stopped before
	// compiler execution.
	Status Status
	// Plan is the planned static syntax scope for this session.
	Plan projectindex.ProjectStaticSyntaxPlan
	// PlanTimings are planner-emitted diagnostic timings.
	PlanTimings []projectindex.ProjectIndexPhaseTiming
	// NodeStarted reports whether planning had to consult the TypeScript host.
	NodeStarted bool
	// NodeReasons records TypeScript-host reasons from planning and execution.
	NodeReasons []string
	// NativeOnlyEligible reports whether this plan can use the native-only
	// compile stream when the compiler supports it.
	NativeOnlyEligible bool
	// Patch is the Project Index AST patch when Status is StatusComplete.
	Patch projectindex.IndexPatch
	// StaticTiming is timing metadata returned by the Static Index executor.
	StaticTiming run.Timing
	// UsedStaticIndex is true when Patch came from the Static Index compiler lane.
	UsedStaticIndex bool
}

func resultFromPlan(plan planner.InspectResult) Result {
	return Result{
		Plan:        plan.Plan,
		PlanTimings: append([]projectindex.ProjectIndexPhaseTiming(nil), plan.Timings...),
		NodeStarted: plan.NodeStarted,
		NodeReasons: append([]string(nil), plan.NodeReasons...),
	}
}

func addNodeReason(result *Result, reason string) {
	if reason == "" {
		return
	}
	result.NodeStarted = true
	for _, existing := range result.NodeReasons {
		if existing == reason {
			return
		}
	}
	result.NodeReasons = append(result.NodeReasons, reason)
}
