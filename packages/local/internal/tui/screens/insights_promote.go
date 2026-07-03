package screens

import (
	"context"
	"fmt"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

// promoteFix promotes the winning variant from the focused insight's first
// linked experiment through the existing baseline promotion surface.
func (s *Insights) promoteFix(client DataClient) tea.Cmd {
	cur := s.currentInsight()
	if cur == nil || client == nil || len(cur.LinkedExperimentIDs) == 0 {
		return nil
	}
	insightID := cur.InsightID
	experimentID := cur.LinkedExperimentIDs[0]
	return func() tea.Msg {
		detail, found, err := client.ExperimentDetail(context.Background(), experimentID)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		if !found {
			return dataErrMsg(fmt.Sprintf("linked experiment %q not found", experimentID))
		}
		variant := bestExperimentVariant(detail)
		if variant == "" {
			return dataErrMsg(fmt.Sprintf("linked experiment %q has no promotable variant", experimentID))
		}
		res, err := client.PromoteBaseline(context.Background(), experimentID, variant, "")
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return insightPromotedMsg{insightID: insightID, result: res}
	}
}

type insightPromotedMsg struct {
	insightID string
	result    api.QualityPromoteResult
}
