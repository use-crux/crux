package screens

import (
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

var runStatusFilters = []string{"failed", "running", "passed"}

func (s *Runs) activeRunStatusFilter() string {
	if s.runStatusIndex <= 0 || s.runStatusIndex > len(runStatusFilters) {
		return ""
	}
	return runStatusFilters[s.runStatusIndex-1]
}

func (s *Runs) filteredRuns() []api.InspectRunRecord {
	status := s.activeRunStatusFilter()
	query := strings.ToLower(strings.TrimSpace(s.runQuery))
	runs := s.selectableRuns()
	if status == "" && query == "" {
		return runs
	}
	out := make([]api.InspectRunRecord, 0, len(runs))
	for _, run := range runs {
		if status != "" && run.Status != status {
			continue
		}
		if query != "" && !runMatchesQuery(run, query) {
			continue
		}
		out = append(out, run)
	}
	return out
}

func runMatchesQuery(run api.InspectRunRecord, query string) bool {
	haystack := strings.ToLower(strings.Join([]string{
		run.TraceID,
		run.TargetID,
		run.Status,
		run.Model,
		run.Provider,
	}, " "))
	return strings.Contains(haystack, query)
}
