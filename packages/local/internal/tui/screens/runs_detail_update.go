package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

func (s *Runs) applyRunDetail(
	ctx context.Context,
	result resource.ResourceResult[api.ObservabilityRunDetail],
	client DataClient,
) tea.Cmd {
	defer s.resizeSpanDocument(s.layout.detail)
	if result.Token.Owner != runsDetailOwner(s.SelectedRunID()) || !s.detailResource.Apply(result) {
		return nil
	}
	if s.pendingLocation != nil && !sameRunsLocationRequest(s.pendingLocation.token, result.Token) {
		s.pendingLocation = nil
	}
	snapshot := s.detailResource.Snapshot()
	if !snapshot.HasValue {
		s.pendingLocation = nil
		return nil
	}
	diagnosis := DiagnoseRun(snapshot.Value)
	s.diagnosis = &diagnosis
	s.replaceSelectedRunSummary(snapshot.Value.Run)
	selectedID := s.SelectedRunID()
	if selectedID != snapshot.Value.Run.RunID {
		return s.followReconciledRunSelection(ctx, client, selectedID)
	}
	s.syncSpanRows()
	s.restorePendingLocation(result.Token)
	return nil
}

func (s *Runs) followReconciledRunSelection(ctx context.Context, client DataClient, selectedID string) tea.Cmd {
	if selectedID == "" {
		s.clearRunSelection()
		return nil
	}
	s.spanList.SetItems(nil)
	s.diagnosis = nil
	return s.fetchRunDetail(ctx, client, selectedID)
}
