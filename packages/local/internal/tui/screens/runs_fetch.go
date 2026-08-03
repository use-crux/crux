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

type runsListLoadedMsg struct {
	resource.ResourceResult[[]api.ObservabilityRunSummary]
	filters runsFilterState
}
type runDetailLoadedMsg resource.ResourceResult[api.ObservabilityRunDetail]
type runDetailIntentMsg struct {
	intent uint64
}
type runsSessionsLoadedMsg struct {
	sessions map[string]bool
}

const runDetailIntentDelay = 35 * time.Millisecond

var runsDetailNow = time.Now

func (m runsListLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return m.Token.Owner
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
	filters := s.filters
	owner := runsListOwnerForDefinition(filters.Definition)
	ctx, token := s.runsResource.Begin(parent, owner, maxRevisionFloor(snapshot.Token.Revision, revision))
	return fetchRunsList(ctx, c, token, filters, s.projectRunsFilters(runsListNow()).request)
}

func fetchRunsList(
	ctx context.Context,
	c DataClient,
	token resource.RequestToken,
	filterState runsFilterState,
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
			return runsListLoadedMsg{ResourceResult: resource.ResourceResult[[]api.ObservabilityRunSummary]{
				Token: token,
				Err:   err,
			}, filters: filterState}
		}
		token.Revision = maxRunRevision(uint64Revision(page.Revision), page.Rows)
		return runsListLoadedMsg{ResourceResult: resource.ResourceResult[[]api.ObservabilityRunSummary]{
			Token: token,
			Value: page.Rows,
		}, filters: filterState}
	}
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
	s.detailPendingRun = runID
	s.detailMovedAt = runsDetailNow()
	if s.detailPending {
		return nil
	}
	s.detailPending = true
	s.detailIntent++
	return s.detailIntentTick(runDetailIntentDelay, s.detailIntent)
}

func (s *Runs) detailIntentTick(delay time.Duration, intent uint64) tea.Cmd {
	return tea.Tick(delay, func(time.Time) tea.Msg {
		return runDetailIntentMsg{intent: intent}
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
