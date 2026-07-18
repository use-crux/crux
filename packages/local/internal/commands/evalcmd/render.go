package evalcmd

import (
	"fmt"
	"io"
	"strings"
)

func renderEvalPlan(out io.Writer, evalID string, plan evalPlanEvent) {
	_, _ = fmt.Fprintf(out, "plan %s: %s; cost %s (known max $%.6f, %d unknown)\n", evalID, plan.Preflight.Status, plan.Cost.Admission.Status, plan.Cost.KnownMaximumUSD, plan.Cost.UnknownActionCount)
	renderHostReadiness(out, plan)
	for _, cell := range plan.Cells {
		_, _ = fmt.Fprintf(out, "  %s/%s/trial-%d: %s (%s)\n", cell.CaseID, cell.Variant, cell.Trial+1, cell.Action.Kind, cell.Action.Reason)
	}
	if planHasUnattestedModel(plan) {
		renderUnattestedModelGuidance(out)
	}
	if planHasUnresolvedSource(plan) {
		renderUnresolvedSourceGuidance(out)
	}
	if planHasUntrackedTaskBinding(plan) {
		renderUntrackedTaskBindingGuidance(out)
	}
	if planHasNondeterministicRenderer(plan) {
		renderNondeterministicRendererGuidance(out)
	}
	for _, action := range plan.ScorerActions {
		_, _ = fmt.Fprintf(out, "  scorer %s: %s (%s); %s; evidence %s; reservation %s; price %s",
			action.ScorerName, action.Kind, action.Reason, action.Admission,
			action.EvidenceRead, action.Reservation.Kind, action.Price.Kind,
		)
		if action.EvidenceReadReason != "" {
			_, _ = fmt.Fprintf(out, " (%s)", action.EvidenceReadReason)
		}
		if action.Reservation.ReservationID != "" {
			_, _ = fmt.Fprintf(out, " [%s]", action.Reservation.ReservationID)
		}
		if action.Evidence.Fingerprint != "" {
			_, _ = fmt.Fprintf(out, "; evidence ref %s", action.Evidence.Fingerprint)
		}
		_, _ = fmt.Fprintln(out)
	}
}

func renderHostReadiness(out io.Writer, plan evalPlanEvent) {
	host := plan.HostReadiness
	switch host.Status {
	case "verified":
		_, _ = fmt.Fprintf(out, "  host verified: %s deployment %s\n", host.HostKind, host.DeploymentID)
	case "local":
		_, _ = fmt.Fprintf(out, "  host local: %s\n", host.Reason)
	case "unverified":
		_, _ = fmt.Fprintf(out, "  host unverified: %s", host.Reason)
		if len(host.Remedies) > 0 {
			_, _ = fmt.Fprintf(out, "; %s", strings.Join(host.Remedies, "; "))
		}
		_, _ = fmt.Fprintln(out)
	case "mismatch":
		_, _ = fmt.Fprintf(out, "  host mismatch: %s; %s\n", host.Reason, host.Remedy)
	}
}

func renderEvalDone(out io.Writer, evalID string, run evalRunEvent, showUnattestedGuidance bool, showSourceGuidance bool, showTaskBindingGuidance bool) {
	for _, cell := range run.Cells {
		_, _ = fmt.Fprintf(out, "  %s/%s/trial-%d: %s; task %s", cell.CaseID, cell.Variant, cell.Trial+1, cell.Status, cell.Task.Status)
		if cell.Task.Reason != "" {
			_, _ = fmt.Fprintf(out, " (%s)", cell.Task.Reason)
		}
		_, _ = fmt.Fprintf(out, "; %dms", cell.Metrics.DurationMS)
		if cell.Metrics.CostUSD != nil {
			_, _ = fmt.Fprintf(out, "; $%.6f", *cell.Metrics.CostUSD)
		}
		if len(cell.Scores) > 0 {
			_, _ = fmt.Fprint(out, "; scores ")
			for index, score := range cell.Scores {
				if index > 0 {
					_, _ = fmt.Fprint(out, ", ")
				}
				renderScore(out, score)
			}
		}
		if cell.Assertions.Ran > 0 || cell.Assertions.NotEvaluated > 0 {
			passed := 0
			for _, outcome := range cell.Assertions.Outcomes {
				if outcome.Status == "passed" {
					passed++
				}
			}
			_, _ = fmt.Fprintf(out, "; assertions %d/%d passed", passed, cell.Assertions.Ran)
		}
		if len(cell.RunIDs) > 0 {
			_, _ = fmt.Fprintf(out, "; runs %s", strings.Join(cell.RunIDs, ", "))
		}
		_, _ = fmt.Fprintln(out)
		for _, outcome := range cell.Assertions.Outcomes {
			if outcome.Status == "failed" && outcome.Message != "" {
				_, _ = fmt.Fprintf(out, "    assertion: %s\n", outcome.Message)
			}
		}
		if cell.Error != nil {
			_, _ = fmt.Fprintf(out, "    %s error: %s\n", cell.Error.Phase, cell.Error.Message)
		}
	}
	if showUnattestedGuidance {
		renderUnattestedModelGuidance(out)
	}
	if showSourceGuidance {
		renderUnresolvedSourceGuidance(out)
	}
	if showTaskBindingGuidance {
		renderUntrackedTaskBindingGuidance(out)
	}
	_, _ = fmt.Fprintf(out, "%s: %s passed=%t run=%s", evalID, run.Status, run.Passed, run.RunID)
	if run.Cost.ActualUSD != nil {
		_, _ = fmt.Fprintf(out, " cost=$%.6f", *run.Cost.ActualUSD)
	}
	_, _ = fmt.Fprintln(out)
}

func planHasUnattestedModel(plan evalPlanEvent) bool {
	for _, cell := range plan.Cells {
		if cell.Action.Reason == "model_identity_unattested" {
			return true
		}
	}
	return false
}

func planHasUnresolvedSource(plan evalPlanEvent) bool {
	for _, cell := range plan.Cells {
		if cell.Action.Reason == "unresolved_source_dependency" {
			return true
		}
	}
	return false
}

func planHasUntrackedTaskBinding(plan evalPlanEvent) bool {
	for _, cell := range plan.Cells {
		if cell.Action.Reason == "task_binding_untracked" {
			return true
		}
	}
	return false
}

func planHasNondeterministicRenderer(plan evalPlanEvent) bool {
	for _, cell := range plan.Cells {
		if cell.Action.Reason == "nondeterministic_renderer" {
			return true
		}
	}
	return false
}

func runHasUnattestedModel(run evalRunEvent) bool {
	for _, cell := range run.Cells {
		if cell.Task.Reason == "model_identity_unattested" {
			return true
		}
	}
	return false
}

func runHasUnresolvedSource(run evalRunEvent) bool {
	for _, cell := range run.Cells {
		if cell.Task.Reason == "unresolved_source_dependency" {
			return true
		}
	}
	return false
}

func runHasUntrackedTaskBinding(run evalRunEvent) bool {
	for _, cell := range run.Cells {
		if cell.Task.Reason == "task_binding_untracked" {
			return true
		}
	}
	return false
}

func renderUnattestedModelGuidance(out io.Writer) {
	_, _ = fmt.Fprintln(out, "  notice: reuse is disabled because this AI SDK model has no stable identity; wrap it with stableModel(model) from @use-crux/ai")
}

func renderUnresolvedSourceGuidance(out io.Writer) {
	_, _ = fmt.Fprintln(out, "  notice: reuse is disabled because Crux could not prove the complete authored source dependency closure; import the production task and its prompt dependencies with literal ESM, or rerun with --fresh when the callback intentionally depends on ambient environment, filesystem, or network state")
}

func renderUntrackedTaskBindingGuidance(out io.Writer) {
	_, _ = fmt.Fprintln(out, "  notice: reuse is disabled because the managed task binding is not a literal ESM import; move generate.task() or stream.task() into a production module and import that task into the Eval")
}

func renderNondeterministicRendererGuidance(out io.Writer) {
	_, _ = fmt.Fprintln(out, "  notice: cached evidence was not reused because this prompt rendered differently for the same input; move environment, time, randomness, filesystem, or network state into Case input, call options, or a Variant, or use --fresh intentionally")
}
