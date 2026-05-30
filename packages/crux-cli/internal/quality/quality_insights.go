package quality

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

func buildQualityInsightsFromRuns(dir string, runs []qualityRunRecord) ([]qualityInsightRecord, error) {
	insights := []qualityInsightRecord{}
	statuses, err := readQualityInsightStatuses(dir)
	if err != nil {
		return nil, err
	}
	experiments, err := readQualityExperimentRecords(dir)
	if err != nil {
		return nil, err
	}
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
				InsightID:           "experiment-" + safeQualityFileName(experiment.ID),
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

	feedback, err := readQualityFeedbackRecords(dir)
	if err != nil {
		return nil, err
	}
	for _, item := range feedback {
		if item.Status != "" && item.Status != "new" {
			continue
		}
		insight := qualityInsightRecord{
			Tag:         "QualityInsight",
			InsightID:   "feedback-" + safeQualityFileName(item.ID),
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
			InsightID:      "tool-loop-" + safeQualityFileName(run.TraceID),
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
				InsightID:      "run-lifecycle-" + safeQualityFileName(run.TraceID),
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
				InsightID:      "run-suspended-" + safeQualityFileName(run.TraceID),
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
				InsightID:      "trace-diagnostics-" + safeQualityFileName(run.TraceID),
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
				InsightID:      "slow-run-" + safeQualityFileName(run.TraceID),
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
				InsightID:      "high-token-usage-" + safeQualityFileName(run.TraceID),
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
				InsightID:      "missing-cost-" + safeQualityFileName(run.TraceID),
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
				InsightID:      "high-cost-" + safeQualityFileName(run.TraceID),
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
				InsightID:      "tool-errors-" + safeQualityFileName(run.TraceID),
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
				InsightID:      "repeated-tool-" + safeQualityFileName(run.TraceID),
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
				InsightID:      "retrieval-issues-" + safeQualityFileName(run.TraceID),
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
				InsightID:      "quality-signal-" + safeQualityFileName(run.TraceID),
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

	cassettes, err := readQualityCassettes(filepath.Join(dir, "cassettes"))
	if err != nil {
		return nil, err
	}
	for _, cassette := range cassettes {
		if cassette.MissingCount == 0 && cassette.MismatchCount == 0 {
			continue
		}
		insights = append(insights, qualityInsightRecord{
			Tag:                 "QualityInsight",
			InsightID:           "cassette-" + safeQualityFileName(filepath.Base(cassette.Path)),
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
	silences, err := readQualityInsightSilences(dir, false)
	if err != nil {
		return nil, err
	}
	insights = filterSilencedQualityInsights(insights, silences)
	for index := range insights {
		insights[index] = enrichQualityInsightFromRuns(insights[index], runs)
		if status, ok := statuses[insights[index].InsightID]; ok {
			applyQualityInsightStatus(&insights[index], status)
		}
	}
	return insights, nil
}

type qualitySignalSet map[string]map[string]struct{}

func (s qualitySignalSet) add(signal string, traceIDs []string) {
	if s[signal] == nil {
		s[signal] = map[string]struct{}{}
	}
	for _, traceID := range traceIDs {
		s[signal][traceID] = struct{}{}
	}
}

func (s qualitySignalSet) has(signal string, traceID string) bool {
	if s[signal] == nil {
		return false
	}
	_, ok := s[signal][traceID]
	return ok
}

func qualityPatternInsights(runs []qualityRunRecord) ([]qualityInsightRecord, qualitySignalSet) {
	type pattern struct {
		key          string
		title        string
		signal       string
		severity     string
		tags         []string
		summary      string
		targetID     string
		cause        string
		fix          string
		traceIDs     []string
		latestMillis int64
	}
	patterns := map[string]*pattern{}
	add := func(key, title, signal, severity string, tags []string, run qualityRunRecord, cause, fix string) {
		p, ok := patterns[key]
		if !ok {
			p = &pattern{
				key:      key,
				title:    title,
				signal:   signal,
				severity: severity,
				tags:     tags,
				targetID: run.TargetID,
				cause:    cause,
				fix:      fix,
			}
			patterns[key] = p
		}
		p.traceIDs = appendUniqueString(p.traceIDs, run.TraceID)
		if run.StartedAt > p.latestMillis {
			p.latestMillis = run.StartedAt
		}
	}
	for _, run := range runs {
		target := safeQualityFileName(firstNonEmpty(run.TargetID, "unknown"))
		if run.TokenCount >= 10000 {
			add("pattern-high-token-"+target, "Repeated high token usage pattern", "tokens", qualityTokenSeverity(run.TokenCount), []string{"Pattern", "Tokens", "Cost"}, run, "The same target repeatedly crosses the token attention threshold.", "Inspect prompt, context, memory, retrieval, and branching behavior across linked runs to identify the repeated token source.")
			add("pattern-high-token-global", "High token usage is recurring", "tokens", qualityTokenSeverity(run.TokenCount), []string{"Pattern", "Tokens", "Cost"}, run, "Many runs are crossing the token attention threshold.", "Inspect linked runs for common prompt, context, memory, retrieval, composition, or model-selection causes.")
		}
		if run.TokenCount > 0 && (run.Cost == nil || *run.Cost == 0) {
			add("pattern-missing-cost-"+target, "Repeated usage without cost pattern", "missing-cost", "low", []string{"Pattern", "Cost", "Instrumentation"}, run, "The same target repeatedly reports token usage without cost.", "Check provider pricing metadata and adapter usage mapping for linked runs.")
			add("pattern-missing-cost-global", "Usage without cost is recurring", "missing-cost", "low", []string{"Pattern", "Cost", "Instrumentation"}, run, "Multiple runs report token usage without cost.", "Check provider pricing metadata and adapter usage mapping across linked runs.")
		}
		if run.Status == "suspended" || run.SuspensionSignalCount > 0 {
			add("pattern-suspension-"+target, "Repeated suspension pattern", "suspension", "low", []string{"Pattern", "Flow", "Suspension"}, run, "The same target repeatedly reaches a suspension point.", "Inspect linked flow suspension markers and verify approval/signal handling is expected.")
			add("pattern-suspension-global", "Suspensions are recurring", "suspension", "low", []string{"Pattern", "Flow", "Suspension"}, run, "Multiple runs are reaching suspension points.", "Inspect linked suspension markers and verify approval/signal handling is expected.")
		}
		if run.DurationMs != nil && *run.DurationMs >= 60000 {
			add("pattern-slow-"+target, "Repeated slow run pattern", "latency", qualityLatencySeverity(*run.DurationMs), []string{"Pattern", "Latency", "Performance"}, run, "The same target repeatedly exceeds the latency attention threshold.", "Compare linked run waterfalls to find recurring slow generations, tools, retrieval, or fanout branches.")
			add("pattern-slow-global", "Slow runs are recurring", "latency", qualityLatencySeverity(*run.DurationMs), []string{"Pattern", "Latency", "Performance"}, run, "Many runs are crossing the latency attention threshold.", "Compare linked run waterfalls for common slow generations, tools, retrieval stages, or fanout patterns.")
		}
		if run.Cost != nil && *run.Cost >= 0.05 {
			add("pattern-high-cost-"+target, "Repeated high cost pattern", "cost", qualityCostSeverity(*run.Cost), []string{"Pattern", "Cost", "Tokens"}, run, "The same target repeatedly crosses the cost attention threshold.", "Inspect linked runs for expensive models, long contexts, retries, or repeated composition branches.")
			add("pattern-high-cost-global", "High cost is recurring", "cost", qualityCostSeverity(*run.Cost), []string{"Pattern", "Cost", "Tokens"}, run, "Many runs are crossing the cost attention threshold.", "Inspect linked runs for common expensive models, long contexts, retries, or repeated composition branches.")
		}
		if run.ToolErrorCount > 0 {
			add("pattern-tool-errors-"+target, "Repeated tool failure pattern", "tool-errors", "medium", []string{"Pattern", "Tools", "Reliability"}, run, "Tool execution is failing across multiple runs for the same target.", "Inspect tool argument validation, downstream service errors, and model-emitted tool requests across linked runs.")
			add("pattern-tool-errors-global", "Tool failures are recurring", "tool-errors", "medium", []string{"Pattern", "Tools", "Reliability"}, run, "Tool execution is failing across multiple runs.", "Inspect tool argument validation, downstream service errors, and model-emitted tool requests across linked runs.")
		}
		for _, code := range run.DiagnosticCodes {
			codeKey := safeQualityFileName(code)
			add("pattern-diagnostic-"+target+"-"+codeKey, "Repeated observability diagnostic pattern", "diagnostic", qualityDiagnosticSeverity([]string{code}), []string{"Pattern", "Observability"}, run, "The same observability diagnostic is recurring across runs.", "Inspect the linked run diagnostics and fix the runtime boundary or primitive that repeatedly loses lifecycle data.")
			add("pattern-diagnostic-global-"+codeKey, "Observability diagnostics are recurring", "diagnostic", qualityDiagnosticSeverity([]string{code}), []string{"Pattern", "Observability"}, run, "The same observability diagnostic is recurring across runs.", "Inspect linked diagnostics and fix the runtime boundary or primitive that repeatedly loses lifecycle data.")
		}
	}
	insights := []qualityInsightRecord{}
	suppressed := qualitySignalSet{}
	for _, p := range patterns {
		if len(p.traceIDs) < 2 {
			continue
		}
		suppressed.add(p.signal, p.traceIDs)
		targetSummary := "multiple targets"
		targetID := ""
		if !strings.HasSuffix(p.key, "-global") && !strings.Contains(p.key, "-global-") {
			targetSummary = p.targetID
			targetID = p.targetID
		}
		insights = append(insights, qualityInsightRecord{
			Tag:             "QualityInsight",
			InsightID:       p.key,
			Title:           p.title,
			Severity:        p.severity,
			Tags:            p.tags,
			Summary:         fmt.Sprintf("%s occurred across %d runs for %s.", p.title, len(p.traceIDs), targetSummary),
			TargetID:        targetID,
			LinkedTraceIDs:  p.traceIDs,
			SuspectedCause:  p.cause,
			ProposedFix:     p.fix,
			OccurrenceCount: len(p.traceIDs),
			Status:          "open",
			UpdatedAt:       qualityMillisToRFC3339(p.latestMillis),
		})
	}
	return insights, suppressed
}

func enrichQualityInsightFromRuns(insight qualityInsightRecord, runs []qualityRunRecord) qualityInsightRecord {
	insight.OccurrenceCount = len(insight.LinkedTraceIDs)
	if insight.OccurrenceCount == 0 {
		insight.OccurrenceCount = len(insight.LinkedCaseIDs) + len(insight.LinkedExperimentIDs) + len(insight.LinkedCassettePaths)
	}
	runs = filterQualityInsightRuns(insight, runs)
	insight.Trend = qualityInsightOccurrenceTrend(insight, runs)
	tokens := 0.0
	for _, run := range runs {
		tokens += float64(run.TokenCount)
	}
	if len(runs) > 0 {
		tokens = tokens / float64(len(runs))
	}
	latency := 0.0
	if p95 := qualityP95Latency(runs); p95 != nil {
		latency = *p95
	}
	cost := 0.0
	if len(runs) > 0 {
		cost = (qualityTotalCost(runs) / float64(len(runs))) * 100
	}
	tokenSpark := qualityHourlyTokenSpark(runs)
	latencySpark := qualityHourlyLatencySpark(runs)
	costSpark := qualityHourlyCostSpark(runs)
	insight.DetailStats = &qualityInsightDetailStats{
		TokensPerRun:           tokens,
		TokensSpark:            tokenSpark,
		TokensDeltaVsBaseline:  qualityDeltaLabel(tokenSpark),
		LatencyP95Ms:           latency,
		LatencySpark:           latencySpark,
		LatencyDeltaVsBaseline: qualityDeltaLabel(latencySpark),
		CostPer100:             cost,
		CostSpark:              costSpark,
		CostDeltaVsBaseline:    qualityDeltaLabel(costSpark),
	}
	return insight
}

func qualityDiagnosticSeverity(codes []string) string {
	for _, code := range codes {
		switch code {
		case "stale-boundary", "missing-span-end", "operation-deadline-exceeded", "convex-boundary-lease-expired":
			return "high"
		}
	}
	return "medium"
}

func qualityLatencySeverity(durationMs float64) string {
	if durationMs >= 180000 {
		return "high"
	}
	return "medium"
}

func qualityTokenSeverity(tokens int) string {
	if tokens >= 25000 {
		return "high"
	}
	return "medium"
}

func qualityCostSeverity(cost float64) string {
	if cost >= 0.25 {
		return "high"
	}
	return "medium"
}

func qualitySignalSeverity(blocked int) string {
	if blocked > 0 {
		return "high"
	}
	return "medium"
}

func filterQualityInsightRuns(insight qualityInsightRecord, runs []qualityRunRecord) []qualityRunRecord {
	if len(insight.LinkedTraceIDs) == 0 {
		return runs
	}
	filtered := make([]qualityRunRecord, 0, len(runs))
	for _, run := range runs {
		if containsString(insight.LinkedTraceIDs, run.TraceID) {
			filtered = append(filtered, run)
		}
	}
	return filtered
}

func applyQualityInsightStatus(insight *qualityInsightRecord, status qualityInsightStatusRecord) {
	insight.ResolvedAt = status.ResolvedAt
	insight.ResolvedOccurrences = status.ResolvedOccurrences
	if status.Status == "resolved" && status.ResolvedOccurrences > 0 && insight.OccurrenceCount > status.ResolvedOccurrences {
		now := time.Now().UTC().Format(time.RFC3339Nano)
		insight.Status = "open"
		insight.ReopenedAt = now
		insight.PreviousResolutionAt = status.ResolvedAt
		insight.UpdatedAt = now
		return
	}
	insight.Status = status.Status
	insight.UpdatedAt = status.UpdatedAt
}

func filterSilencedQualityInsights(insights []qualityInsightRecord, silences []qualityInsightSilenceRecord) []qualityInsightRecord {
	if len(silences) == 0 {
		return insights
	}
	filtered := make([]qualityInsightRecord, 0, len(insights))
	for _, insight := range insights {
		if qualityInsightIsSilenced(insight, silences) {
			continue
		}
		filtered = append(filtered, insight)
	}
	return filtered
}

func qualityInsightIsSilenced(insight qualityInsightRecord, silences []qualityInsightSilenceRecord) bool {
	for _, silence := range silences {
		if silence.DeletedAt != "" || silence.Pattern.Title == "" || silence.Pattern.Title != insight.Title {
			continue
		}
		if silence.Pattern.TargetID == "" || silence.Pattern.TargetID == insight.TargetID {
			return true
		}
	}
	return false
}

func persistQualityInsightStatus(dir string, insightID string, req qualityInsightStatusRequest, resolvedOccurrences int) (qualityInsightStatusRecord, error) {
	if insightID == "" {
		return qualityInsightStatusRecord{}, fmt.Errorf("insightId is required")
	}
	if req.Status != "open" && req.Status != "dismissed" && req.Status != "resolved" {
		return qualityInsightStatusRecord{}, fmt.Errorf("status must be open, dismissed, or resolved")
	}
	record := qualityInsightStatusRecord{
		Tag:       "QualityInsightStatus",
		InsightID: insightID,
		Status:    req.Status,
		Note:      req.Note,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if req.Status == "resolved" {
		record.ResolvedAt = record.UpdatedAt
		record.ResolvedOccurrences = resolvedOccurrences
	}
	if err := appendQualityJSONLine(filepath.Join(dir, "insights", "status.jsonl"), record); err != nil {
		return qualityInsightStatusRecord{}, err
	}
	return record, nil
}

func readQualityInsightStatuses(dir string) (map[string]qualityInsightStatusRecord, error) {
	raw, err := readQualityJSONLines(filepath.Join(dir, "insights", "status.jsonl"))
	if err != nil {
		return nil, err
	}
	statuses := map[string]qualityInsightStatusRecord{}
	for _, item := range raw {
		var record qualityInsightStatusRecord
		if err := json.Unmarshal(item, &record); err != nil {
			return nil, err
		}
		if record.InsightID != "" {
			statuses[record.InsightID] = record
		}
	}
	return statuses, nil
}

func persistQualityInsightSilence(dir string, req qualityInsightSilenceRequest) (qualityInsightSilenceRecord, error) {
	if req.Pattern == nil {
		return qualityInsightSilenceRecord{}, fmt.Errorf("pattern is required")
	}
	pattern := normalizeQualityInsightSilencePattern(*req.Pattern)
	if pattern.Title == "" {
		return qualityInsightSilenceRecord{}, fmt.Errorf("pattern.title is required")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	record := qualityInsightSilenceRecord{
		Tag:       "QualityInsightSilence",
		ID:        qualityInsightSilenceID(pattern),
		Pattern:   pattern,
		Note:      req.Note,
		CreatedAt: now,
	}
	if err := appendQualityJSONLine(filepath.Join(dir, "insights", "silences.jsonl"), record); err != nil {
		return qualityInsightSilenceRecord{}, err
	}
	return record, nil
}

func readQualityInsightSilences(dir string, includeDeleted bool) ([]qualityInsightSilenceRecord, error) {
	raw, err := readQualityJSONLines(filepath.Join(dir, "insights", "silences.jsonl"))
	if err != nil {
		return nil, err
	}
	byID := map[string]qualityInsightSilenceRecord{}
	order := []string{}
	for _, item := range raw {
		var record qualityInsightSilenceRecord
		if err := json.Unmarshal(item, &record); err != nil {
			return nil, err
		}
		if record.ID == "" {
			continue
		}
		if _, exists := byID[record.ID]; !exists {
			order = append(order, record.ID)
		}
		byID[record.ID] = record
	}
	out := make([]qualityInsightSilenceRecord, 0, len(order))
	for _, id := range order {
		record := byID[id]
		if !includeDeleted && record.DeletedAt != "" {
			continue
		}
		out = append(out, record)
	}
	return out, nil
}

func deleteQualityInsightSilence(dir string, silenceID string) (qualityInsightSilenceRecord, error) {
	if silenceID == "" {
		return qualityInsightSilenceRecord{}, fmt.Errorf("silenceId is required")
	}
	silences, err := readQualityInsightSilences(dir, true)
	if err != nil {
		return qualityInsightSilenceRecord{}, err
	}
	var existing *qualityInsightSilenceRecord
	for index := range silences {
		if silences[index].ID == silenceID {
			existing = &silences[index]
		}
	}
	if existing == nil || existing.DeletedAt != "" {
		return qualityInsightSilenceRecord{}, fmt.Errorf("quality insight silence %q not found", silenceID)
	}
	record := *existing
	record.DeletedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := appendQualityJSONLine(filepath.Join(dir, "insights", "silences.jsonl"), record); err != nil {
		return qualityInsightSilenceRecord{}, err
	}
	return record, nil
}

func normalizeQualityInsightSilencePattern(pattern qualityInsightSilencePattern) qualityInsightSilencePattern {
	pattern.Title = strings.TrimSpace(pattern.Title)
	pattern.TargetID = strings.TrimSpace(pattern.TargetID)
	return pattern
}

func qualityInsightSilenceID(pattern qualityInsightSilencePattern) string {
	hash := sha1.Sum([]byte(pattern.Title + "\x00" + pattern.TargetID))
	return "silence-" + hex.EncodeToString(hash[:8])
}
