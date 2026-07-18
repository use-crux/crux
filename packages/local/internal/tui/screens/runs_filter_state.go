package screens

import (
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

type runStatusFilter struct {
	label  string
	status string
}

var runStatusFilters = []runStatusFilter{
	{label: "failed", status: "fail"},
	{label: "running", status: "running"},
	{label: "passed", status: "ok"},
}

func (s *Runs) activeRunStatusFilter() runStatusFilter {
	if s.runStatusIndex <= 0 || s.runStatusIndex > len(runStatusFilters) {
		return runStatusFilter{}
	}
	return runStatusFilters[s.runStatusIndex-1]
}

func (s *Runs) filteredRuns() []api.ObservabilityRunSummary {
	filter := s.activeRunStatusFilter()
	query := strings.ToLower(strings.TrimSpace(s.runQuery))
	runs := s.selectableRuns()
	if filter.status == "" && query == "" {
		return runs
	}
	out := make([]api.ObservabilityRunSummary, 0, len(runs))
	for _, run := range runs {
		if filter.status != "" && normalizeObservabilityStatus(run.Status) != filter.status {
			continue
		}
		if query != "" && !runMatchesQuery(run, query) {
			continue
		}
		out = append(out, run)
	}
	return out
}

func runMatchesQuery(run api.ObservabilityRunSummary, query string) bool {
	haystack := strings.ToLower(strings.Join([]string{
		run.RunID,
		run.Name,
		run.RootPrimitive,
		run.Status,
		run.Model,
		run.Provider,
	}, " "))
	return strings.Contains(haystack, query)
}
