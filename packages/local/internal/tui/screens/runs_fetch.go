package screens

import (
	"context"
	"errors"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/store"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

// --- fetch -------------------------------------------------------------------

type runsListLoadedMsg resource.ResourceResult[[]api.ObservabilityRunSummary]
type runDetailLoadedMsg resource.ResourceResult[api.ObservabilityRunDetail]
type runDetailIntentMsg struct {
	runID  string
	intent uint64
}
type runsSessionsLoadedMsg struct {
	sessions map[string]bool
}

const runDetailIntentDelay = 10 * time.Millisecond

func (m runsListLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return resource.ResourceResult[[]api.ObservabilityRunSummary](m).Token.Owner
}

func (m runDetailLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return resource.ResourceResult[api.ObservabilityRunDetail](m).Token.Owner
}

var runsListOwner = runsListOwnerForDefinition("")

func runsListOwnerForDefinition(definitionID string) resource.ResourceOwner {
	return resource.ResourceOwner{Screen: "runs", Resource: "list", RecordID: definitionID}
}

func runsDetailOwner(runID string) resource.ResourceOwner {
	return resource.ResourceOwner{Screen: "runs", Resource: "detail", RecordID: runID}
}

func (s *Runs) fetchRunsList(parent context.Context, c DataClient) tea.Cmd {
	return s.fetchRunsListAtRevision(parent, c, 0)
}

func (s *Runs) fetchRunsListAtRevision(parent context.Context, c DataClient, revision uint64) tea.Cmd {
	snapshot := s.runsResource.Snapshot()
	owner := runsListOwnerForDefinition(s.definitionFilter)
	ctx, token := s.runsResource.Begin(parent, owner, maxRevisionFloor(snapshot.Token.Revision, revision))
	return fetchRunsList(ctx, c, token, s.inspectRunsOptions(runsListNow()))
}

func fetchRunsList(
	ctx context.Context,
	c DataClient,
	token resource.RequestToken,
	filters api.InspectRunsOptions,
) tea.Cmd {
	return func() tea.Msg {
		var page api.ObservabilityRunsPage
		var err error
		if inspectRunsOptionsEmpty(filters) {
			page, err = c.ObservabilityRunsPage(ctx, token.Owner.RecordID)
		} else {
			page, err = c.ObservabilityRunsPageWithOptions(ctx, filters, token.Owner.RecordID)
		}
		if err != nil {
			return runsListLoadedMsg(resource.ResourceResult[[]api.ObservabilityRunSummary]{
				Token: token,
				Err:   err,
			})
		}
		if !inspectRunsOptionsEmpty(filters) {
			inspectRows, inspectErr := c.RunsWithOptions(ctx, filters)
			if inspectErr != nil {
				return runsListLoadedMsg(resource.ResourceResult[[]api.ObservabilityRunSummary]{
					Token: token,
					Err:   inspectErr,
				})
			}
			page.Rows = runsAllowedByInspect(page.Rows, inspectRows)
		}
		token.Revision = maxRunRevision(uint64Revision(page.Revision), page.Rows)
		return runsListLoadedMsg(resource.ResourceResult[[]api.ObservabilityRunSummary]{
			Token: token,
			Value: page.Rows,
		})
	}
}

func runsAllowedByInspect(
	runs []api.ObservabilityRunSummary,
	inspectRows []api.InspectRunRecord,
) []api.ObservabilityRunSummary {
	allowed := make(map[string]bool, len(inspectRows))
	for _, run := range inspectRows {
		id := firstNonEmpty(run.OperationID, run.TraceID)
		if id != "" {
			allowed[id] = true
		}
	}
	filtered := runs[:0]
	for _, run := range runs {
		if allowed[firstNonEmpty(run.OperationID, run.RunID)] {
			filtered = append(filtered, run)
		}
	}
	return filtered
}

func fetchRunsSessions(ctx context.Context, c DataClient) tea.Cmd {
	if c == nil {
		return nil
	}
	return func() tea.Msg {
		sessions, err := c.Sessions(ctx)
		if err != nil {
			return runsSessionsLoadedMsg{}
		}
		return runsSessionsLoadedMsg{sessions: sessionSet(sessions)}
	}
}

func sessionSet(sessions []store.SessionInfo) map[string]bool {
	if len(sessions) == 0 {
		return nil
	}
	result := make(map[string]bool, len(sessions))
	for _, session := range sessions {
		if session.SessionID != "" {
			result[session.SessionID] = true
		}
	}
	return result
}

func uint64Revision(revision int64) uint64 {
	if revision <= 0 {
		return 0
	}
	return uint64(revision)
}

func maxRunRevision(floor uint64, runs []api.ObservabilityRunSummary) uint64 {
	maximum := floor
	for _, run := range runs {
		if run.Revision > 0 && uint64(run.Revision) > maximum {
			maximum = uint64(run.Revision)
		}
	}
	return maximum
}

func maxRevisionFloor(left, right uint64) uint64 {
	if right > left {
		return right
	}
	return left
}

func (s *Runs) fetchRunDetail(parent context.Context, c DataClient, runID string) tea.Cmd {
	return s.fetchRunDetailAtRevision(parent, c, runID, 0)
}

func (s *Runs) scheduleRunDetail(runID string) tea.Cmd {
	if runID == "" {
		return nil
	}
	s.detailIntent++
	intent := s.detailIntent
	return tea.Tick(runDetailIntentDelay, func(time.Time) tea.Msg {
		return runDetailIntentMsg{runID: runID, intent: intent}
	})
}

func (s *Runs) fetchRunDetailAtRevision(parent context.Context, c DataClient, runID string, revision uint64) tea.Cmd {
	cmd, _ := s.beginRunDetailFetchAtRevision(parent, c, runID, revision)
	return cmd
}

func (s *Runs) beginRunDetailFetch(parent context.Context, c DataClient, runID string) (tea.Cmd, resource.RequestToken) {
	return s.beginRunDetailFetchAtRevision(parent, c, runID, 0)
}

func (s *Runs) beginRunDetailFetchAtRevision(parent context.Context, c DataClient, runID string, revision uint64) (tea.Cmd, resource.RequestToken) {
	snapshot := s.detailResource.Snapshot()
	owner := runsDetailOwner(runID)
	if snapshot.Token.Owner == owner {
		revision = maxRevisionFloor(revision, snapshot.Token.Revision)
	}
	for _, run := range s.runSummaries() {
		if run.RunID == runID && run.Revision > 0 && uint64(run.Revision) > revision {
			revision = uint64(run.Revision)
			break
		}
	}
	if snapshot.Token.Owner != owner {
		s.diagnosis = nil
		s.spanList.SetItems(nil)
	}
	ctx, token := s.detailResource.Begin(parent, owner, revision)
	return fetchRunDetail(ctx, c, token), token
}

func fetchRunDetail(ctx context.Context, c DataClient, token resource.RequestToken) tea.Cmd {
	return func() tea.Msg {
		detail, found, detailErr := c.ObservabilityRunDetail(ctx, token.Owner.RecordID)
		if detailErr != nil {
			return runDetailLoadedMsg(resource.ResourceResult[api.ObservabilityRunDetail]{Token: token, Err: detailErr})
		}
		if !found {
			return runDetailLoadedMsg(resource.ResourceResult[api.ObservabilityRunDetail]{Token: token, Err: errors.New("run not found")})
		}
		token.Revision = uint64Revision(detail.Run.Revision)
		return runDetailLoadedMsg(resource.ResourceResult[api.ObservabilityRunDetail]{Token: token, Value: detail})
	}
}
