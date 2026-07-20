package inspect

import (
	"fmt"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/inspectfs"
)

type inspectInsightInputs struct {
	Statuses map[string]inspectfs.InsightStatus
	Silences []inspectfs.InsightSilence
	Runs     []inspectRunRecord
	Now      time.Time
}

func deriveInsights(in inspectInsightInputs) []inspectInsightRecord {
	runs := in.Runs
	insights := []inspectInsightRecord{}
	statuses := in.Statuses

	patternInsights, suppressedRunSignals := inspectPatternInsights(runs)
	latestSuccessByTarget := map[string]int64{}
	for _, run := range runs {
		if run.TargetID != "" && (run.Status == "ok" || run.Status == "success") && run.StartedAt > latestSuccessByTarget[run.TargetID] {
			latestSuccessByTarget[run.TargetID] = run.StartedAt
		}
	}

	for _, run := range runs {
		if run.ToolCallCount < 8 {
			continue
		}
		insights = append(insights, inspectInsightRecord{
			Tag:            "InspectInsight",
			InsightID:      "tool-loop-" + inspectfs.SafeFileName(inspectRunIdentity(run)),
			Title:          "Potential tool loop detected",
			Severity:       "high",
			Tags:           []string{"Agent Looping", "Tools"},
			Summary:        fmt.Sprintf("%s made %d tool calls in one run.", run.TargetID, run.ToolCallCount),
			TargetID:       run.TargetID,
			LinkedTraceIDs: []string{inspectRunIdentity(run)},
			SuspectedCause: "The model may be retrying similar tool calls without a stopping condition or sufficient context.",
			ProposedFix:    "Inspect the trace waterfall, add an iteration guard, or tighten tool instructions and retrieval limits.",
			Status:         "open",
		})
	}

	for _, run := range runs {
		if (run.Status == "stale" || run.Status == "incomplete") && !suppressedRunSignals.has("lifecycle", inspectRunIdentity(run)) {
			severity := "high"
			latestSuccess := latestSuccessByTarget[run.TargetID]
			if run.Status == "incomplete" && run.TargetID != "" && run.StartedAt > 0 && latestSuccess > 0 && latestSuccess > run.StartedAt {
				severity = "medium"
			}
			insights = append(insights, inspectInsightRecord{
				Tag:            "InspectInsight",
				InsightID:      "run-lifecycle-" + inspectfs.SafeFileName(inspectRunIdentity(run)),
				Title:          "Run did not close cleanly",
				Severity:       severity,
				Tags:           []string{"Observability", "Runtime"},
				Summary:        fmt.Sprintf("%s is %s and may have missing terminal records.", run.TargetID, run.Status),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{inspectRunIdentity(run)},
				SuspectedCause: "A runtime boundary, worker shutdown, or unawaited asynchronous operation may have prevented terminal telemetry from reaching the Go service.",
				ProposedFix:    "Inspect the run diagnostics and ensure runtime adapters await Crux flushes and close spans on suspension, stop conditions, and errors.",
				Status:         "open",
			})
		}
		if (run.Status == "suspended" || run.SuspensionSignalCount > 0) && !suppressedRunSignals.has("suspension", inspectRunIdentity(run)) {
			insights = append(insights, inspectInsightRecord{
				Tag:            "InspectInsight",
				InsightID:      "run-suspended-" + inspectfs.SafeFileName(inspectRunIdentity(run)),
				Title:          "Run is waiting on a suspension",
				Severity:       "low",
				Tags:           []string{"Flow", "Suspension"},
				Summary:        fmt.Sprintf("%s reached a suspension point and is waiting to resume.", run.TargetID),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{inspectRunIdentity(run)},
				ProposedFix:    "Resume the flow or inspect the suspension span to verify the expected approval or signal is pending.",
				Status:         "open",
			})
		}
		if run.DiagnosticCount > 0 && !suppressedRunSignals.has("diagnostic", inspectRunIdentity(run)) {
			insights = append(insights, inspectInsightRecord{
				Tag:            "InspectInsight",
				InsightID:      "trace-diagnostics-" + inspectfs.SafeFileName(inspectRunIdentity(run)),
				Title:          "Trace has observability diagnostics",
				Severity:       inspectDiagnosticSeverity(run.DiagnosticCodes),
				Tags:           []string{"Observability"},
				Summary:        fmt.Sprintf("%s has %d trace diagnostic(s): %s.", run.TargetID, run.DiagnosticCount, strings.Join(run.DiagnosticCodes, ", ")),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{inspectRunIdentity(run)},
				SuspectedCause: "The backend reconciler detected missing terminal records, stale boundaries, or deadline-repaired spans.",
				ProposedFix:    "Open the run detail diagnostics and fix the emitting primitive or runtime boundary responsible for the missing lifecycle signal.",
				Status:         "open",
			})
		}
		if run.DurationMs != nil && *run.DurationMs >= 60000 && !suppressedRunSignals.has("latency", inspectRunIdentity(run)) {
			insights = append(insights, inspectInsightRecord{
				Tag:            "InspectInsight",
				InsightID:      "slow-run-" + inspectfs.SafeFileName(inspectRunIdentity(run)),
				Title:          "Run is slow",
				Severity:       inspectLatencySeverity(*run.DurationMs),
				Tags:           []string{"Latency", "Performance"},
				Summary:        fmt.Sprintf("%s took %.1fs end-to-end.", run.TargetID, *run.DurationMs/1000),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{inspectRunIdentity(run)},
				ProposedFix:    "Inspect the waterfall for slow generations, tool calls, retrieval, or parallel branches that dominate the run.",
				Status:         "open",
			})
		}
		if run.TokenCount >= 10000 && !suppressedRunSignals.has("tokens", inspectRunIdentity(run)) {
			insights = append(insights, inspectInsightRecord{
				Tag:            "InspectInsight",
				InsightID:      "high-token-usage-" + inspectfs.SafeFileName(inspectRunIdentity(run)),
				Title:          "Run has high token usage",
				Severity:       inspectTokenSeverity(run.TokenCount),
				Tags:           []string{"Tokens", "Cost"},
				Summary:        fmt.Sprintf("%s used %d tokens.", run.TargetID, run.TokenCount),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{inspectRunIdentity(run)},
				ProposedFix:    "Inspect prompt, context, memory, retrieval, and generation details to find the largest token contributors.",
				Status:         "open",
			})
		}
		if run.TokenCount > 0 && (run.Cost == nil || *run.Cost == 0) && !suppressedRunSignals.has("missing-cost", inspectRunIdentity(run)) {
			insights = append(insights, inspectInsightRecord{
				Tag:            "InspectInsight",
				InsightID:      "missing-cost-" + inspectfs.SafeFileName(inspectRunIdentity(run)),
				Title:          "Run has usage without cost",
				Severity:       "low",
				Tags:           []string{"Cost", "Instrumentation"},
				Summary:        fmt.Sprintf("%s reported %d tokens but no cost.", run.TargetID, run.TokenCount),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{inspectRunIdentity(run)},
				ProposedFix:    "Check provider pricing metadata or adapter usage mapping so cost can roll up to runs and parent spans.",
				Status:         "open",
			})
		}
		if run.Cost != nil && *run.Cost >= 0.05 && !suppressedRunSignals.has("cost", inspectRunIdentity(run)) {
			insights = append(insights, inspectInsightRecord{
				Tag:            "InspectInsight",
				InsightID:      "high-cost-" + inspectfs.SafeFileName(inspectRunIdentity(run)),
				Title:          "Run is costly",
				Severity:       inspectCostSeverity(*run.Cost),
				Tags:           []string{"Cost", "Tokens"},
				Summary:        fmt.Sprintf("%s cost $%.4f.", run.TargetID, *run.Cost),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{inspectRunIdentity(run)},
				ProposedFix:    "Inspect token and model rollups by span to identify expensive generations, fanout, or retries.",
				Status:         "open",
			})
		}
		if run.ToolErrorCount > 0 && !suppressedRunSignals.has("tool-errors", inspectRunIdentity(run)) {
			insights = append(insights, inspectInsightRecord{
				Tag:            "InspectInsight",
				InsightID:      "tool-errors-" + inspectfs.SafeFileName(inspectRunIdentity(run)),
				Title:          "Tool calls failed",
				Severity:       "medium",
				Tags:           []string{"Tools", "Reliability"},
				Summary:        fmt.Sprintf("%s had %d failing tool call(s).", run.TargetID, run.ToolErrorCount),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{inspectRunIdentity(run)},
				SuspectedCause: "Tool arguments, runtime validation, network calls, or downstream services may have failed.",
				ProposedFix:    "Open the tool span inspection data and compare model-emitted request, validated args, result, and error payload.",
				Status:         "open",
			})
		}
		if run.RepeatedToolCount >= 5 && !suppressedRunSignals.has("repeated-tool", inspectRunIdentity(run)) {
			insights = append(insights, inspectInsightRecord{
				Tag:            "InspectInsight",
				InsightID:      "repeated-tool-" + inspectfs.SafeFileName(inspectRunIdentity(run)),
				Title:          "Repeated tool calls detected",
				Severity:       "medium",
				Tags:           []string{"Agent Looping", "Tools"},
				Summary:        fmt.Sprintf("%s called %s %d times.", run.TargetID, run.RepeatedToolName, run.RepeatedToolCount),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{inspectRunIdentity(run)},
				SuspectedCause: "The model may be retrying the same operation or receiving insufficient stopping evidence.",
				ProposedFix:    "Inspect the chronological generation and tool chain, then tighten tool instructions, retry policy, or stopping conditions.",
				Status:         "open",
			})
		}
		if run.RetrievalIssueCount > 0 && !suppressedRunSignals.has("retrieval", inspectRunIdentity(run)) {
			insights = append(insights, inspectInsightRecord{
				Tag:            "InspectInsight",
				InsightID:      "retrieval-issues-" + inspectfs.SafeFileName(inspectRunIdentity(run)),
				Title:          "Retrieval needs attention",
				Severity:       "medium",
				Tags:           []string{"Retrieval", "RAG"},
				Summary:        fmt.Sprintf("%s had %d retrieval signal(s) with no or failed results.", run.TargetID, run.RetrievalIssueCount),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{inspectRunIdentity(run)},
				ProposedFix:    "Inspect retrieval query, filters, hit counts, and source coverage in the run detail.",
				Status:         "open",
			})
		}
		if (run.InspectSignalIssueCount > 0 || run.BlockedSignalCount > 0) && !suppressedRunSignals.has("inspect-signal", inspectRunIdentity(run)) {
			insights = append(insights, inspectInsightRecord{
				Tag:            "InspectInsight",
				InsightID:      "inspect-signal-" + inspectfs.SafeFileName(inspectRunIdentity(run)),
				Title:          "Safety, guardrail, or scoring signal needs attention",
				Severity:       inspectSignalSeverity(run.BlockedSignalCount),
				Tags:           []string{"Safety", "Scoring", "Constraints"},
				Summary:        fmt.Sprintf("%s had %d safety/scoring/constraint signal(s) needing attention.", run.TargetID, run.InspectSignalIssueCount+run.BlockedSignalCount),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{inspectRunIdentity(run)},
				ProposedFix:    "Inspect guardrail, constraint, scoring, and citation spans to understand whether the run was blocked, failed, or scored poorly.",
				Status:         "open",
			})
		}
	}
	insights = append(insights, patternInsights...)

	insights = filterSilencedInspectInsights(insights, activeInspectInsightSilences(in.Silences))
	for index := range insights {
		insights[index] = enrichInspectInsightFromRuns(insights[index], runs, in.Now)
		if status, ok := statuses[insights[index].InsightID]; ok {
			applyInspectInsightStatus(&insights[index], status, in.Now)
		}
	}
	return insights
}
