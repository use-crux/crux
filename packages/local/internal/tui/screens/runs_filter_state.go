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

// runsFilterState is the only mutable Runs filter state. Request parameters,
// visible summary text, and local row projection are all derived from one
// snapshot of this value.
type runsFilterState struct {
	Query      string
	Status     int
	Window     int
	Group      int
	Session    string
	Model      string
	Definition string
}

func defaultRunsFilterState() runsFilterState {
	return runsFilterState{Window: len(runWindows) - 1}
}

type runsFilterSummary struct {
	Query, Status, Window, Group, Session, Model, Definition string
}

type runsFilterProjection struct {
	state   runsFilterState
	request api.InspectRunsOptions
	summary runsFilterSummary
	cutoff  int64
}

func (state runsFilterState) requestIdentity() runsFilterState {
	state.Query = ""
	state.Group = 0
	return state
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
	if s.filters.Status < 0 || s.filters.Status >= len(runStatusFilters) {
		return runStatusFilters[0]
	}
	return runStatusFilters[s.filters.Status]
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

type runsListProjectionKey struct {
	request, revision uint64
	valueVersion      uint64
	ownerScreen       string
	ownerResource     string
	ownerRecord       string
	filters           runsFilterState
	routed            string
	routedRevision    int64
	routedName        string
	routedPrimitive   string
	routedStatus      string
	routedModel       string
	routedProvider    string
	routedSession     string
	routedStartedAt   string
	cutoff            int64
}

type runsListProjection struct {
	valid       bool
	key         runsListProjectionKey
	rows        []api.ObservabilityRunSummary
	groupStarts map[string]bool
	groups      map[string][]api.ObservabilityRunSummary
}

func (s *Runs) activeRunWindow() runWindow {
	if s.filters.Window < 0 || s.filters.Window >= len(runWindows) {
		return runWindows[len(runWindows)-1]
	}
	return runWindows[s.filters.Window]
}

func (s *Runs) activeRunGroup() runGroup {
	if s.filters.Group < 0 || s.filters.Group >= len(runGroups) {
		return runGroups[0]
	}
	return runGroups[s.filters.Group]
}

func (s *Runs) inspectRunsOptions(now time.Time) api.InspectRunsOptions {
	return s.projectRunsFilters(now).request
}

func (s *Runs) projectRunsFilters(now time.Time) runsFilterProjection {
	state := s.filters
	status := s.activeRunStatusFilter()
	window := s.activeRunWindow()
	group := s.activeRunGroup()
	projection := runsFilterProjection{state: state, request: api.InspectRunsOptions{
		Status: append([]string(nil), s.activeRunStatusFilter().statuses...),
		Limit:  100,
	}, summary: runsFilterSummary{
		Query: state.Query, Status: status.label, Window: window.label, Group: group.label,
		Session: state.Session, Model: state.Model, Definition: state.Definition,
	}}
	if window.duration > 0 {
		projection.cutoff = now.Add(-window.duration).UnixMilli()
		projection.request.Since = projection.cutoff
	}
	if state.Session != "" {
		projection.request.Session = []string{state.Session}
	}
	if state.Model != "" {
		projection.request.Model = []string{state.Model}
	}
	return projection
}

func inspectRunsOptionsEmpty(options api.InspectRunsOptions) bool {
	return len(options.Status) == 0 &&
		len(options.Session) == 0 &&
		len(options.Model) == 0 &&
		options.Since == 0 &&
		options.Until == 0
}

func (s *Runs) filteredRuns() []api.ObservabilityRunSummary {
	now := runsListNow()
	snapshot := s.runsResource.Snapshot()
	key := runsListProjectionKey{
		request:       snapshot.Token.Request,
		revision:      snapshot.Token.Revision,
		valueVersion:  s.runsValueVersion,
		ownerScreen:   snapshot.Token.Owner.Screen,
		ownerResource: snapshot.Token.Owner.Resource,
		ownerRecord:   snapshot.Token.Owner.RecordID,
		filters:       s.filters,
	}
	if s.routedRun != nil {
		key.routed = s.routedRun.RunID
		key.routedRevision = s.routedRun.Revision
		key.routedName = s.routedRun.Name
		key.routedPrimitive = s.routedRun.RootPrimitive
		key.routedStatus = s.routedRun.Status
		key.routedModel = s.routedRun.Model
		key.routedProvider = s.routedRun.Provider
		key.routedSession = s.routedRun.SessionID
		key.routedStartedAt = s.routedRun.StartedAt
	}
	if window := s.activeRunWindow(); window.duration > 0 {
		key.cutoff = now.Add(-window.duration).UnixMilli()
	}
	if s.projection.valid && s.projection.key == key {
		return s.projection.rows
	}

	filters := s.projectRunsFilters(now)
	filter := s.activeRunStatusFilter()
	query := strings.ToLower(strings.TrimSpace(filters.state.Query))
	runs := s.selectableRuns()
	out := make([]api.ObservabilityRunSummary, 0, len(runs))
	cutoff := filters.cutoff
	for _, run := range runs {
		if len(filter.statuses) > 0 && !runStatusMatches(run.Status, filter.statuses) {
			continue
		}
		if cutoff > 0 && parseObservabilityTime(run.StartedAt) < cutoff {
			continue
		}
		if filters.state.Session != "" && run.SessionID != filters.state.Session {
			continue
		}
		if filters.state.Model != "" && !strings.EqualFold(run.Model, filters.state.Model) {
			continue
		}
		if query != "" && !runMatchesQuery(run, query) {
			continue
		}
		out = append(out, run)
	}
	rows := s.groupRuns(out)
	projection := runsListProjection{
		valid:       true,
		key:         key,
		rows:        rows,
		groupStarts: map[string]bool{},
		groups:      map[string][]api.ObservabilityRunSummary{},
	}
	if filters.state.Group != 0 {
		previous := ""
		for index, run := range rows {
			groupKey := s.runGroupKey(run)
			projection.groups[groupKey] = append(projection.groups[groupKey], run)
			if index == 0 || groupKey != previous {
				projection.groupStarts[run.RunID] = true
			}
			previous = groupKey
		}
	}
	s.projection = projection
	return s.projection.rows
}

// syncVisibleRuns is the sole resource+filter-to-pane reconciliation path.
// filteredRuns remains the authoritative derivation; the ListPane is only its
// cursor/viewport representation.
func (s *Runs) syncVisibleRuns() []api.ObservabilityRunSummary {
	runs := s.filteredRuns()
	s.runList.SetItems(runs)
	return runs
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
	if s.filters.Group == 0 || len(runs) < 2 {
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
	if s.filters.Group == 0 {
		return false
	}
	s.filteredRuns()
	return s.projection.groupStarts[run.RunID]
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
