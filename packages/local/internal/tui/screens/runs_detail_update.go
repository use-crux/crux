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
	selectedID := s.SelectedRunID()
	if result.Token.Owner != runsDetailOwner(selectedID) {
		return nil
	}
	if result.Value.Run.RunID != "" && result.Value.Run.RunID != selectedID {
		if memberDetail, ok := detailForSelectedMember(result.Value, selectedID); ok {
			result.Value = memberDetail
			result.Token.Revision = maxRevisionFloor(result.Token.Revision, uint64Revision(memberDetail.Run.Revision))
		}
	}
	if !s.detailResource.Apply(result) {
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
	s.showAllSpans = !runStatusFailed(snapshot.Value.Run.Status) || !s.hasDescendantFailure()
	s.replaceSelectedRunSummary(snapshot.Value.Run)
	selectedID = s.SelectedRunID()
	if selectedID != snapshot.Value.Run.RunID {
		return s.followReconciledRunSelection(ctx, client, selectedID)
	}
	s.syncSpanRows()
	if !s.showAllSpans {
		s.selectFailure(0)
	}
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
