package quality

import (
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// applyRunsOptions filters / sorts / paginates a runs slice in place
// according to opts. Returns a new slice; the input is left untouched
// for the caller.
func applyRunsOptions(runs []qualityRunRecord, opts api.QualityRunsOptions) []qualityRunRecord {
	out := make([]qualityRunRecord, 0, len(runs))
	for _, r := range runs {
		if !matchesRunsOptions(r, opts) {
			continue
		}
		out = append(out, r)
	}

	switch strings.ToLower(opts.Sort) {
	case "duration":
		sortRunsByDuration(out, strings.ToLower(opts.Order) == "asc")
	case "cost":
		sortRunsByCost(out, strings.ToLower(opts.Order) == "asc")
	case "tokens":
		sortRunsByTokens(out, strings.ToLower(opts.Order) == "asc")
	default:
		// Default: time desc (newest first).
		sort.SliceStable(out, func(i, j int) bool {
			return out[i].StartedAt > out[j].StartedAt
		})
	}

	if opts.Offset > 0 {
		if opts.Offset >= len(out) {
			return out[:0]
		}
		out = out[opts.Offset:]
	}
	if opts.Limit > 0 && len(out) > opts.Limit {
		out = out[:opts.Limit]
	}
	return out
}

func matchesRunsOptions(r qualityRunRecord, opts api.QualityRunsOptions) bool {
	if len(opts.Status) > 0 && !containsStringFold(opts.Status, r.Status) {
		return false
	}
	if len(opts.Target) > 0 && !containsStringFold(opts.Target, r.TargetID) {
		return false
	}
	if len(opts.Kind) > 0 && !containsStringFold(opts.Kind, r.Kind) {
		return false
	}
	if len(opts.Model) > 0 && !containsStringFold(opts.Model, r.Model) {
		return false
	}
	if len(opts.Has) > 0 && !matchesRunsHasOptions(r, opts.Has) {
		return false
	}
	if len(opts.Session) > 0 && !containsStringFold(opts.Session, r.SessionID) {
		return false
	}
	if len(opts.Primitive) > 0 {
		// Run-level primitive = trace if leaf, flow when FlowID set.
		prim := api.SpanPrimitiveGeneration
		if r.FlowID != "" {
			prim = api.SpanPrimitiveFlow
		}
		if !containsStringFold(opts.Primitive, prim) {
			return false
		}
	}
	if opts.Since > 0 && r.StartedAt < opts.Since {
		return false
	}
	if opts.Until > 0 && r.StartedAt > opts.Until {
		return false
	}
	if q := strings.ToLower(strings.TrimSpace(opts.Search)); q != "" {
		hay := strings.ToLower(r.TraceID + " " + r.TargetID + " " + flattenInput(r.Input))
		if !strings.Contains(hay, q) {
			return false
		}
	}
	return true
}

func matchesRunsHasOptions(r qualityRunRecord, values []string) bool {
	for _, value := range values {
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "feedback":
			if r.FeedbackCount > 0 || len(r.FeedbackIDs) > 0 {
				return true
			}
		case "experiment":
			if len(r.ExperimentIDs) > 0 {
				return true
			}
		}
	}
	return false
}

func containsStringFold(haystack []string, needle string) bool {
	if needle == "" {
		return false
	}
	low := strings.ToLower(needle)
	for _, s := range haystack {
		if strings.ToLower(strings.TrimSpace(s)) == low {
			return true
		}
	}
	return false
}

func flattenInput(input map[string]any) string {
	if len(input) == 0 {
		return ""
	}
	parts := make([]string, 0, len(input))
	for _, v := range input {
		switch t := v.(type) {
		case string:
			parts = append(parts, t)
		}
	}
	return strings.Join(parts, " ")
}

func sortRunsByDuration(rs []qualityRunRecord, asc bool) {
	sort.SliceStable(rs, func(i, j int) bool {
		a := runDuration(rs[i])
		b := runDuration(rs[j])
		if asc {
			return a < b
		}
		return a > b
	})
}

func sortRunsByCost(rs []qualityRunRecord, asc bool) {
	sort.SliceStable(rs, func(i, j int) bool {
		a := runCost(rs[i])
		b := runCost(rs[j])
		if asc {
			return a < b
		}
		return a > b
	})
}

func sortRunsByTokens(rs []qualityRunRecord, asc bool) {
	sort.SliceStable(rs, func(i, j int) bool {
		if asc {
			return rs[i].TokenCount < rs[j].TokenCount
		}
		return rs[i].TokenCount > rs[j].TokenCount
	})
}

func runDuration(r qualityRunRecord) float64 {
	if r.DurationMs == nil {
		return 0
	}
	return *r.DurationMs
}

func runCost(r qualityRunRecord) float64 {
	if r.Cost == nil {
		return 0
	}
	return *r.Cost
}

func qualityRunTabCountsFromRuns(runs []qualityRunRecord) qualityRunTabCounts {
	counts := qualityRunTabCounts{All: len(runs)}
	for _, run := range runs {
		if isLiveRunStatus(run.Status) {
			counts.Live++
		}
		if isFailureRunStatus(run.Status) {
			counts.Failures++
		}
		if run.FeedbackCount > 0 || len(run.FeedbackIDs) > 0 {
			counts.HasFeedback++
		}
	}
	return counts
}

func isLiveRunStatus(status string) bool {
	return strings.ToLower(strings.TrimSpace(normalizeStatus(status))) == "running"
}

func isFailureRunStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(normalizeStatus(status))) {
	case "error", "fail", "failed", "blocked", "cancelled", "incomplete", "stale":
		return true
	default:
		return false
	}
}
