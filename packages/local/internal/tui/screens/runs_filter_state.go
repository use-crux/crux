package screens

import (
	"sort"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

type runStatusFilter struct {
	label    string
	statuses []string
}

var runStatusFilters = []runStatusFilter{
	{label: "all"},
	{label: "live", statuses: []string{"running"}},
	{label: "failures", statuses: []string{"error", "fail", "failed"}},
}

func runStatusFilterIndex(label string) int {
	for i, filter := range runStatusFilters {
		if filter.label == label {
			return i
		}
	}
	return 0
}

func (s *Runs) activeRunStatusFilter() runStatusFilter {
	if s.runStatusIndex < 0 || s.runStatusIndex >= len(runStatusFilters) {
		return runStatusFilters[0]
	}
	return runStatusFilters[s.runStatusIndex]
}

type runWindow struct {
	label    string
	duration time.Duration
}

var runWindows = []runWindow{
	{label: "1h", duration: time.Hour},
	{label: "24h", duration: 24 * time.Hour},
	{label: "7d", duration: 7 * 24 * time.Hour},
	{label: "all"},
}

type runGroup struct {
	label string
}

var runGroups = []runGroup{
	{label: "none"},
	{label: "primitive"},
	{label: "target"},
	{label: "session"},
}

var runsListNow = time.Now

func (s *Runs) activeRunWindow() runWindow {
	if s.runWindowIndex < 0 || s.runWindowIndex >= len(runWindows) {
		return runWindows[len(runWindows)-1]
	}
	return runWindows[s.runWindowIndex]
}

func (s *Runs) activeRunGroup() runGroup {
	if s.runGroupIndex < 0 || s.runGroupIndex >= len(runGroups) {
		return runGroups[0]
	}
	return runGroups[s.runGroupIndex]
}

func (s *Runs) inspectRunsOptions(now time.Time) api.InspectRunsOptions {
	options := api.InspectRunsOptions{
		Status: append([]string(nil), s.activeRunStatusFilter().statuses...),
		Limit:  100,
	}
	if window := s.activeRunWindow(); window.duration > 0 {
		options.Since = now.Add(-window.duration).UnixMilli()
	}
	if s.sessionFilter != "" {
		options.Session = []string{s.sessionFilter}
	}
	if s.modelFilter != "" {
		options.Model = []string{s.modelFilter}
	}
	return options
}

func inspectRunsOptionsEmpty(options api.InspectRunsOptions) bool {
	return len(options.Status) == 0 &&
		len(options.Session) == 0 &&
		len(options.Model) == 0 &&
		options.Since == 0 &&
		options.Until == 0
}

func (s *Runs) filteredRuns() []api.ObservabilityRunSummary {
	filter := s.activeRunStatusFilter()
	query := strings.ToLower(strings.TrimSpace(s.runQuery))
	runs := s.selectableRuns()
	out := make([]api.ObservabilityRunSummary, 0, len(runs))
	cutoff := int64(0)
	if window := s.activeRunWindow(); window.duration > 0 {
		cutoff = runsListNow().Add(-window.duration).UnixMilli()
	}
	for _, run := range runs {
		if len(filter.statuses) > 0 && !runStatusMatches(run.Status, filter.statuses) {
			continue
		}
		if cutoff > 0 && parseObservabilityTime(run.StartedAt) < cutoff {
			continue
		}
		if s.sessionFilter != "" && run.SessionID != s.sessionFilter {
			continue
		}
		if s.modelFilter != "" && !strings.EqualFold(run.Model, s.modelFilter) {
			continue
		}
		if query != "" && !runMatchesQuery(run, query) {
			continue
		}
		out = append(out, run)
	}
	return s.groupRuns(out)
}

func runStatusMatches(status string, accepted []string) bool {
	for _, candidate := range accepted {
		if strings.EqualFold(status, candidate) {
			return true
		}
	}
	return false
}

func (s *Runs) groupRuns(runs []api.ObservabilityRunSummary) []api.ObservabilityRunSummary {
	if s.runGroupIndex == 0 || len(runs) < 2 {
		return runs
	}
	order := make([]string, 0)
	groups := make(map[string][]api.ObservabilityRunSummary)
	for _, run := range runs {
		key := s.runGroupKey(run)
		if _, exists := groups[key]; !exists {
			order = append(order, key)
		}
		groups[key] = append(groups[key], run)
	}
	grouped := make([]api.ObservabilityRunSummary, 0, len(runs))
	for _, key := range order {
		grouped = append(grouped, groups[key]...)
	}
	return grouped
}

func (s *Runs) runGroupKey(run api.ObservabilityRunSummary) string {
	switch s.activeRunGroup().label {
	case "primitive":
		return firstNonEmpty(run.RootPrimitive, "unknown")
	case "target":
		return firstNonEmpty(run.Name, run.RootPrimitive, run.RunID)
	case "session":
		return firstNonEmpty(run.SessionID, "no session")
	default:
		return ""
	}
}

func (s *Runs) isRunGroupStart(run api.ObservabilityRunSummary) bool {
	if s.runGroupIndex == 0 {
		return false
	}
	runs := s.filteredRuns()
	for index, candidate := range runs {
		if candidate.RunID != run.RunID {
			continue
		}
		return index == 0 || s.runGroupKey(runs[index-1]) != s.runGroupKey(candidate)
	}
	return false
}

func (s *Runs) rememberRunModels(runs []api.ObservabilityRunSummary) {
	known := make(map[string]bool, len(s.knownModels)+len(runs))
	for _, model := range s.knownModels {
		known[model] = true
	}
	for _, run := range runs {
		if run.Model != "" {
			known[run.Model] = true
		}
	}
	s.knownModels = s.knownModels[:0]
	for model := range known {
		s.knownModels = append(s.knownModels, model)
	}
	sort.Strings(s.knownModels)
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
