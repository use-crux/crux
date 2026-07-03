package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

type experimentsListLoadedMsg []api.QualityExperimentSummary

type experimentDetailLoadedMsg struct {
	experimentID string
	detail       api.QualityExperimentDetail
	found        bool
}

type experimentProgressLoadedMsg struct {
	evaluationID string
	progress     api.QualityEvaluationProgress
	found        bool
}

func fetchExperimentSummaries(c DataClient) tea.Cmd {
	if c == nil {
		return nil
	}
	return func() tea.Msg {
		recs, err := c.ExperimentSummaries(context.Background())
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return experimentsListLoadedMsg(recs)
	}
}

func (s *Experiments) fetchDetail(c DataClient) tea.Cmd {
	expID := s.selectedID
	if c == nil || expID == "" {
		return nil
	}
	return func() tea.Msg {
		detail, found, err := c.ExperimentDetail(context.Background(), expID)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return experimentDetailLoadedMsg{experimentID: expID, detail: detail, found: found}
	}
}

func (s *Experiments) fetchProgress(c DataClient) tea.Cmd {
	cur := s.currentSummary()
	if c == nil || cur == nil || cur.EvaluationID == "" {
		return nil
	}
	evaluationID := cur.EvaluationID
	return func() tea.Msg {
		progress, found, err := c.EvaluationProgress(context.Background(), evaluationID, 12)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return experimentProgressLoadedMsg{evaluationID: evaluationID, progress: progress, found: found}
	}
}
