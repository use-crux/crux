package screens

import (
	"context"
	"errors"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

// --- fetch -------------------------------------------------------------------

type runsListLoadedMsg resource.ResourceResult[[]api.ObservabilityRunSummary]
type runDetailLoadedMsg resource.ResourceResult[api.ObservabilityRunDetail]

var runsListOwner = resource.ResourceOwner{Screen: "runs", Resource: "list"}

func runsDetailOwner(runID string) resource.ResourceOwner {
	return resource.ResourceOwner{Screen: "runs", Resource: "detail", RecordID: runID}
}

func (s *Runs) fetchRunsList(parent context.Context, c DataClient) tea.Cmd {
	snapshot := s.runsResource.Snapshot()
	ctx, token := s.runsResource.Begin(parent, runsListOwner, snapshot.Token.Revision)
	return fetchRunsList(ctx, c, token)
}

func fetchRunsList(ctx context.Context, c DataClient, token resource.RequestToken) tea.Cmd {
	return func() tea.Msg {
		page, err := c.ObservabilityRunsPage(ctx)
		if err != nil {
			return runsListLoadedMsg(resource.ResourceResult[[]api.ObservabilityRunSummary]{
				Token: token,
				Err:   err,
			})
		}
		token.Revision = maxRunRevision(uint64Revision(page.Revision), page.Rows)
		return runsListLoadedMsg(resource.ResourceResult[[]api.ObservabilityRunSummary]{
			Token: token,
			Value: page.Rows,
		})
	}
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

func (s *Runs) fetchRunDetail(parent context.Context, c DataClient, runID string) tea.Cmd {
	snapshot := s.detailResource.Snapshot()
	owner := runsDetailOwner(runID)
	revision := uint64(0)
	if snapshot.Token.Owner == owner {
		revision = snapshot.Token.Revision
	}
	for _, run := range s.runSummaries() {
		if run.RunID == runID && run.Revision > 0 && uint64(run.Revision) > revision {
			revision = uint64(run.Revision)
			break
		}
	}
	if snapshot.Token.Owner != owner {
		s.detail = nil
		s.selSpan = ""
	}
	ctx, token := s.detailResource.Begin(parent, owner, revision)
	return fetchRunDetail(ctx, c, token)
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
