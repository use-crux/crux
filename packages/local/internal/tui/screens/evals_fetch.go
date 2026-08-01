package screens

import (
	"context"
	"encoding/json"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

var evalCatalogResourceOwner = resource.ResourceOwner{Screen: "evals", Resource: "catalog"}
var evalRunsResourceOwner = resource.ResourceOwner{Screen: "evals", Resource: "runs"}
var evalRunResourceOwner = resource.ResourceOwner{Screen: "evals", Resource: "run"}
var evalBaselinesResourceOwner = resource.ResourceOwner{Screen: "evals", Resource: "baselines"}
var evalLocalRunResourceOwner = resource.ResourceOwner{Screen: "evals", Resource: "local-run"}

func evalRunOwner(runID string) resource.ResourceOwner {
	owner := evalRunResourceOwner
	owner.RecordID = runID
	return owner
}

func evalLocalRunOwner(runID string) resource.ResourceOwner {
	owner := evalLocalRunResourceOwner
	owner.RecordID = runID
	return owner
}

type evalCatalogLoadedMsg resource.ResourceResult[[]json.RawMessage]
type evalRunsLoadedMsg resource.ResourceResult[[]json.RawMessage]
type evalRunLoadedMsg resource.ResourceResult[json.RawMessage]
type evalBaselinesLoadedMsg resource.ResourceResult[[]json.RawMessage]
type evalLocalRunLoadedMsg resource.ResourceResult[evalRunAvailability]
type evalCatalogProgressMsg struct{ request uint64 }

const evalCatalogProgressInterval = time.Second

func (message evalCatalogLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return resource.ResourceResult[[]json.RawMessage](message).Token.Owner
}

func (message evalRunsLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return resource.ResourceResult[[]json.RawMessage](message).Token.Owner
}

func (message evalRunLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return resource.ResourceResult[json.RawMessage](message).Token.Owner
}

func (message evalBaselinesLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return resource.ResourceResult[[]json.RawMessage](message).Token.Owner
}

func (message evalLocalRunLoadedMsg) ResourceOwner() resource.ResourceOwner {
	return resource.ResourceResult[evalRunAvailability](message).Token.Owner
}

func (s *Evals) fetchCatalog(parent context.Context, client DataClient, revision uint64) tea.Cmd {
	if client == nil {
		return nil
	}
	snapshot := s.catalogResource.Snapshot()
	ctx, token := s.catalogResource.Begin(
		parent, evalCatalogResourceOwner, maxRevisionFloor(snapshot.Token.Revision, revision),
	)
	s.catalogSince = s.now()
	s.catalogElapsed = 0
	fetch := func() tea.Msg {
		value, err := client.EvalCatalog(ctx)
		return evalCatalogLoadedMsg(resource.ResourceResult[[]json.RawMessage]{Token: token, Value: value, Err: err})
	}
	return tea.Batch(fetch, evalCatalogProgressTick(token.Request))
}

func evalCatalogProgressTick(request uint64) tea.Cmd {
	return tea.Tick(evalCatalogProgressInterval, func(time.Time) tea.Msg {
		return evalCatalogProgressMsg{request: request}
	})
}

func (s *Evals) fetchRuns(parent context.Context, client DataClient, revision uint64) tea.Cmd {
	if client == nil {
		return nil
	}
	snapshot := s.runsResource.Snapshot()
	ctx, token := s.runsResource.Begin(
		parent, evalRunsResourceOwner, maxRevisionFloor(snapshot.Token.Revision, revision),
	)
	return func() tea.Msg {
		value, err := client.EvalRuns(ctx)
		return evalRunsLoadedMsg(resource.ResourceResult[[]json.RawMessage]{Token: token, Value: value, Err: err})
	}
}

func (s *Evals) fetchSelectedRun(parent context.Context, client DataClient, revision uint64) tea.Cmd {
	if client == nil || s.selectedRunID == "" {
		return nil
	}
	runID := s.selectedRunID
	snapshot := s.runResource.Snapshot()
	ctx, token := s.runResource.Begin(
		parent, evalRunOwner(runID), maxRevisionFloor(snapshot.Token.Revision, revision),
	)
	return func() tea.Msg {
		value, err := client.EvalRun(ctx, runID)
		return evalRunLoadedMsg(resource.ResourceResult[json.RawMessage]{Token: token, Value: value, Err: err})
	}
}

func (s *Evals) fetchBaselines(parent context.Context, client DataClient, revision uint64) tea.Cmd {
	if client == nil {
		return nil
	}
	snapshot := s.baselinesResource.Snapshot()
	ctx, token := s.baselinesResource.Begin(
		parent, evalBaselinesResourceOwner, maxRevisionFloor(snapshot.Token.Revision, revision),
	)
	return func() tea.Msg {
		value, err := client.EvalBaselines(ctx)
		return evalBaselinesLoadedMsg(resource.ResourceResult[[]json.RawMessage]{Token: token, Value: value, Err: err})
	}
}

func (s *Evals) fetchSelectedLocalRun(parent context.Context, client DataClient) tea.Cmd {
	runID := s.selectedObservedRunID()
	if runID == "" {
		s.localRunResource.Cancel()
		return nil
	}
	snapshot := s.localRunResource.Snapshot()
	if snapshot.Token.Owner == evalLocalRunOwner(runID) &&
		snapshot.State != resource.ResourceIdle {
		return nil
	}
	return s.fetchLocalRun(parent, client, runID, 0)
}

func (s *Evals) fetchLocalRun(
	parent context.Context,
	client DataClient,
	runID string,
	revision uint64,
) tea.Cmd {
	if client == nil || runID == "" {
		return nil
	}
	snapshot := s.localRunResource.Snapshot()
	ctx, token := s.localRunResource.Begin(
		parent, evalLocalRunOwner(runID), maxRevisionFloor(snapshot.Token.Revision, revision),
	)
	s.syncDetail(false)
	return func() tea.Msg {
		_, found, err := client.ObservabilityRunDetail(ctx, runID)
		return evalLocalRunLoadedMsg(resource.ResourceResult[evalRunAvailability]{
			Token: token, Value: evalRunAvailability{Checked: err == nil, Available: found}, Err: err,
		})
	}
}
