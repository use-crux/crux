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
	if result.Token.Owner != runsDetailOwner(s.SelectedRunID()) || !s.detailResource.Apply(result) {
		return nil
	}
	snapshot := s.detailResource.Snapshot()
	if !snapshot.HasValue {
		s.bumpRenderRev()
		return nil
	}
	detail := inspectRunDetailFromObservabilityDetail(snapshot.Value)
	previousSpanID := s.selSpan
	s.detail = &detail
	s.replaceSelectedRunSummary(snapshot.Value.Run)
	selectedID := s.SelectedRunID()
	if selectedID != snapshot.Value.Run.RunID {
		return s.followReconciledRunSelection(ctx, client, selectedID)
	}
	s.selSpan = ""
	for _, span := range detail.Spans {
		if span.ID == previousSpanID {
			s.selSpan = previousSpanID
			break
		}
	}
	if s.selSpan == "" && len(detail.Spans) > 0 {
		s.selSpan = detail.Spans[0].ID
	}
	s.bumpRenderRev()
	return nil
}

func (s *Runs) followReconciledRunSelection(ctx context.Context, client DataClient, selectedID string) tea.Cmd {
	if selectedID == "" {
		s.clearRunSelection()
		s.bumpRenderRev()
		return nil
	}
	s.selSpan = ""
	s.detail = nil
	s.bumpRenderRev()
	return s.fetchRunDetail(ctx, client, selectedID)
}
