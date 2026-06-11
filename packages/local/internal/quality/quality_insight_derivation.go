package quality

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/qualityfs"
)

type qualityInsightInputs struct {
	Quality *qualityfs.Snapshot
	Runs    []qualityRunRecord
	Now     time.Time
}

func deriveInsights(in qualityInsightInputs) []qualityInsightRecord {
	snapshot := in.Quality
	if snapshot == nil {
		snapshot = &qualityfs.Snapshot{}
	}
	runs := in.Runs
	insights := []qualityInsightRecord{}
	statuses := snapshot.Statuses
	experiments := snapshot.Experiments
	for _, experiment := range experiments {
		failedCaseIDs := []string{}
		for _, testCase := range experiment.Cases {
			if testCase.Status != "" && testCase.Status != "passed" {
				failedCaseIDs = appendUniqueString(failedCaseIDs, testCase.CaseID)
			}
		}
		if experiment.Summary.Failed > 0 || experiment.Summary.Errored > 0 || len(failedCaseIDs) > 0 {
			insights = append(insights, qualityInsightRecord{
				Tag:                 "QualityInsight",
				InsightID:           "experiment-" + qualityfs.SafeFileName(experiment.ID),
				Title:               "Experiment has failed quality cases",
				Severity:            qualityFailureSeverity(experiment.Summary.Errored),
				Tags:                []string{"Experiment", "Regression"},
				Summary:             fmt.Sprintf("%s has %d failed and %d errored cases.", experiment.ID, experiment.Summary.Failed, experiment.Summary.Errored),
				LinkedExperimentIDs: []string{experiment.ID},
				LinkedCaseIDs:       failedCaseIDs,
				ProposedFix:         "Open the experiment, inspect failed case traces, then save regressions to the suite or compare a candidate variant.",
				Status:              "open",
				UpdatedAt:           nonEmptyString(experiment.EndedAt, experiment.StartedAt),
			})
		}
	}

	for _, item := range snapshot.Feedback {
		if item.Status != "" && item.Status != "new" {
			continue
		}
		insight := qualityInsightRecord{
			Tag:         "QualityInsight",
			InsightID:   "feedback-" + qualityfs.SafeFileName(item.ID),
			Title:       "Feedback needs review",
			Severity:    "medium",
			Tags:        []string{"Feedback"},
			Summary:     "A local feedback item has not been reviewed or converted into a suite case.",
			ProposedFix: "Review the feedback, link it to a trace, and export it into a regression suite if it reflects desired behavior.",
			Status:      "open",
			UpdatedAt:   item.CreatedAt,
		}
		if item.TraceID != nil && *item.TraceID != "" {
			insight.LinkedTraceIDs = []string{*item.TraceID}
		}
		if item.ExperimentID != nil && *item.ExperimentID != "" {
			insight.LinkedExperimentIDs = []string{*item.ExperimentID}
		}
		if item.CaseID != nil && *item.CaseID != "" {
			insight.LinkedCaseIDs = []string{*item.CaseID}
		}
		insights = append(insights, insight)
	}

	patternInsights, suppressedRunSignals := qualityPatternInsights(runs)

	for _, run := range runs {
		if run.ToolCallCount < 8 {
			continue
		}
		insights = append(insights, qualityInsightRecord{
			Tag:            "QualityInsight",
			InsightID:      "tool-loop-" + qualityfs.SafeFileName(run.TraceID),
			Title:          "Potential tool loop detected",
			Severity:       "high",
			Tags:           []string{"Agent Looping", "Tools"},
			Summary:        fmt.Sprintf("%s made %d tool calls in one run.", run.TargetID, run.ToolCallCount),
			TargetID:       run.TargetID,
			LinkedTraceIDs: []string{run.TraceID},
			SuspectedCause: "The model may be retrying similar tool calls without a stopping condition or sufficient context.",
			ProposedFix:    "Inspect the trace waterfall, add an iteration guard, or tighten tool instructions and retrieval limits.",
			Status:         "open",
		})
	}

	for _, run := range runs {
		if (run.Status == "stale" || run.Status == "incomplete") && !suppressedRunSignals.has("lifecycle", run.TraceID) {
			insights = append(insights, qualityInsightRecord{
				Tag:            "QualityInsight",
				InsightID:      "run-lifecycle-" + qualityfs.SafeFileName(run.TraceID),
				Title:          "Run did not close cleanly",
				Severity:       "high",
				Tags:           []string{"Observability", "Runtime"},
				Summary:        fmt.Sprintf("%s is %s and may have missing terminal records.", run.TargetID, run.Status),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{run.TraceID},
				SuspectedCause: "A runtime boundary, worker shutdown, or unawaited asynchronous operation may have prevented terminal telemetry from reaching the Go service.",
				ProposedFix:    "Inspect the run diagnostics and ensure runtime adapters await Crux flushes and close spans on suspension, stop conditions, and errors.",
				Status:         "open",
			})
		}
		if (run.Status == "suspended" || run.SuspensionSignalCount > 0) && !suppressedRunSignals.has("suspension", run.TraceID) {
			insights = append(insights, qualityInsightRecord{
				Tag:            "QualityInsight",
				InsightID:      "run-suspended-" + qualityfs.SafeFileName(run.TraceID),
				Title:          "Run is waiting on a suspension",
				Severity:       "low",
				Tags:           []string{"Flow", "Suspension"},
				Summary:        fmt.Sprintf("%s reached a suspension point and is waiting to resume.", run.TargetID),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{run.TraceID},
				ProposedFix:    "Resume the flow or inspect the suspension span to verify the expected approval or signal is pending.",
				Status:         "open",
			})
		}
		if run.DiagnosticCount > 0 && !suppressedRunSignals.has("diagnostic", run.TraceID) {
			insights = append(insights, qualityInsightRecord{
				Tag:            "QualityInsight",
				InsightID:      "trace-diagnostics-" + qualityfs.SafeFileName(run.TraceID),
				Title:          "Trace has observability diagnostics",
				Severity:       qualityDiagnosticSeverity(run.DiagnosticCodes),
				Tags:           []string{"Observability"},
				Summary:        fmt.Sprintf("%s has %d trace diagnostic(s): %s.", run.TargetID, run.DiagnosticCount, strings.Join(run.DiagnosticCodes, ", ")),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{run.TraceID},
				SuspectedCause: "The backend reconciler detected missing terminal records, stale boundaries, or deadline-repaired spans.",
				ProposedFix:    "Open the run detail diagnostics and fix the emitting primitive or runtime boundary responsible for the missing lifecycle signal.",
				Status:         "open",
			})
		}
		if run.DurationMs != nil && *run.DurationMs >= 60000 && !suppressedRunSignals.has("latency", run.TraceID) {
			insights = append(insights, qualityInsightRecord{
				Tag:            "QualityInsight",
				InsightID:      "slow-run-" + qualityfs.SafeFileName(run.TraceID),
				Title:          "Run is slow",
				Severity:       qualityLatencySeverity(*run.DurationMs),
				Tags:           []string{"Latency", "Performance"},
				Summary:        fmt.Sprintf("%s took %.1fs end-to-end.", run.TargetID, *run.DurationMs/1000),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{run.TraceID},
				ProposedFix:    "Inspect the waterfall for slow generations, tool calls, retrieval, or parallel branches that dominate the run.",
				Status:         "open",
			})
		}
		if run.TokenCount >= 10000 && !suppressedRunSignals.has("tokens", run.TraceID) {
			insights = append(insights, qualityInsightRecord{
				Tag:            "QualityInsight",
				InsightID:      "high-token-usage-" + qualityfs.SafeFileName(run.TraceID),
				Title:          "Run has high token usage",
				Severity:       qualityTokenSeverity(run.TokenCount),
				Tags:           []string{"Tokens", "Cost"},
				Summary:        fmt.Sprintf("%s used %d tokens.", run.TargetID, run.TokenCount),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{run.TraceID},
				ProposedFix:    "Inspect prompt, context, memory, retrieval, and generation details to find the largest token contributors.",
				Status:         "open",
			})
		}
		if run.TokenCount > 0 && (run.Cost == nil || *run.Cost == 0) && !suppressedRunSignals.has("missing-cost", run.TraceID) {
			insights = append(insights, qualityInsightRecord{
				Tag:            "QualityInsight",
				InsightID:      "missing-cost-" + qualityfs.SafeFileName(run.TraceID),
				Title:          "Run has usage without cost",
				Severity:       "low",
				Tags:           []string{"Cost", "Instrumentation"},
				Summary:        fmt.Sprintf("%s reported %d tokens but no cost.", run.TargetID, run.TokenCount),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{run.TraceID},
				ProposedFix:    "Check provider pricing metadata or adapter usage mapping so cost can roll up to runs and parent spans.",
				Status:         "open",
			})
		}
		if run.Cost != nil && *run.Cost >= 0.05 && !suppressedRunSignals.has("cost", run.TraceID) {
			insights = append(insights, qualityInsightRecord{
				Tag:            "QualityInsight",
				InsightID:      "high-cost-" + qualityfs.SafeFileName(run.TraceID),
				Title:          "Run is costly",
				Severity:       qualityCostSeverity(*run.Cost),
				Tags:           []string{"Cost", "Tokens"},
				Summary:        fmt.Sprintf("%s cost $%.4f.", run.TargetID, *run.Cost),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{run.TraceID},
				ProposedFix:    "Inspect token and model rollups by span to identify expensive generations, fanout, or retries.",
				Status:         "open",
			})
		}
		if run.ToolErrorCount > 0 && !suppressedRunSignals.has("tool-errors", run.TraceID) {
			insights = append(insights, qualityInsightRecord{
				Tag:            "QualityInsight",
				InsightID:      "tool-errors-" + qualityfs.SafeFileName(run.TraceID),
				Title:          "Tool calls failed",
				Severity:       "medium",
				Tags:           []string{"Tools", "Reliability"},
				Summary:        fmt.Sprintf("%s had %d failing tool call(s).", run.TargetID, run.ToolErrorCount),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{run.TraceID},
				SuspectedCause: "Tool arguments, runtime validation, network calls, or downstream services may have failed.",
				ProposedFix:    "Open the tool span inspection data and compare model-emitted request, validated args, result, and error payload.",
				Status:         "open",
			})
		}
		if run.RepeatedToolCount >= 5 && !suppressedRunSignals.has("repeated-tool", run.TraceID) {
			insights = append(insights, qualityInsightRecord{
				Tag:            "QualityInsight",
				InsightID:      "repeated-tool-" + qualityfs.SafeFileName(run.TraceID),
				Title:          "Repeated tool calls detected",
				Severity:       "medium",
				Tags:           []string{"Agent Looping", "Tools"},
				Summary:        fmt.Sprintf("%s called %s %d times.", run.TargetID, run.RepeatedToolName, run.RepeatedToolCount),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{run.TraceID},
				SuspectedCause: "The model may be retrying the same operation or receiving insufficient stopping evidence.",
				ProposedFix:    "Inspect the chronological generation and tool chain, then tighten tool instructions, retry policy, or stopping conditions.",
				Status:         "open",
			})
		}
		if run.RetrievalIssueCount > 0 && !suppressedRunSignals.has("retrieval", run.TraceID) {
			insights = append(insights, qualityInsightRecord{
				Tag:            "QualityInsight",
				InsightID:      "retrieval-issues-" + qualityfs.SafeFileName(run.TraceID),
				Title:          "Retrieval needs attention",
				Severity:       "medium",
				Tags:           []string{"Retrieval", "RAG"},
				Summary:        fmt.Sprintf("%s had %d retrieval signal(s) with no or failed results.", run.TargetID, run.RetrievalIssueCount),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{run.TraceID},
				ProposedFix:    "Inspect retrieval query, filters, hit counts, and source coverage in the run detail.",
				Status:         "open",
			})
		}
		if (run.QualitySignalIssueCount > 0 || run.BlockedSignalCount > 0) && !suppressedRunSignals.has("quality-signal", run.TraceID) {
			insights = append(insights, qualityInsightRecord{
				Tag:            "QualityInsight",
				InsightID:      "quality-signal-" + qualityfs.SafeFileName(run.TraceID),
				Title:          "Safety, guardrail, or scoring signal needs attention",
				Severity:       qualitySignalSeverity(run.BlockedSignalCount),
				Tags:           []string{"Safety", "Scoring", "Constraints"},
				Summary:        fmt.Sprintf("%s had %d safety/scoring/constraint signal(s) needing attention.", run.TargetID, run.QualitySignalIssueCount+run.BlockedSignalCount),
				TargetID:       run.TargetID,
				LinkedTraceIDs: []string{run.TraceID},
				ProposedFix:    "Inspect guardrail, constraint, scoring, and citation spans to understand whether the run was blocked, failed, or scored poorly.",
				Status:         "open",
			})
		}
	}
	insights = append(insights, patternInsights...)

	for _, cassette := range snapshot.Cassettes {
		if cassette.MissingCount == 0 && cassette.MismatchCount == 0 {
			continue
		}
		insights = append(insights, qualityInsightRecord{
			Tag:                 "QualityInsight",
			InsightID:           "cassette-" + qualityfs.SafeFileName(filepath.Base(cassette.Path)),
			Title:               "Cassette replay has mismatches",
			Severity:            "medium",
			Tags:                []string{"Cassette", "Replay"},
			Summary:             fmt.Sprintf("%s has %d missing and %d mismatched entries.", filepath.Base(cassette.Path), cassette.MissingCount, cassette.MismatchCount),
			LinkedCassettePaths: []string{cassette.Path},
			ProposedFix:         "Inspect the cassette entries and either update expected fixtures intentionally or fix the regression.",
			Status:              "open",
			UpdatedAt:           cassette.RecordedAt,
		})
	}
	insights = filterSilencedQualityInsights(insights, activeQualityInsightSilences(snapshot.Silences))
	for index := range insights {
		insights[index] = enrichQualityInsightFromRuns(insights[index], runs, in.Now)
		if status, ok := statuses[insights[index].InsightID]; ok {
			applyQualityInsightStatus(&insights[index], status, in.Now)
		}
	}
	return insights
}
