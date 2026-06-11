package quality

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/qualityfs"
)

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
		target := qualityfs.SafeFileName(firstNonEmpty(run.TargetID, "unknown"))
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
			codeKey := qualityfs.SafeFileName(code)
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
