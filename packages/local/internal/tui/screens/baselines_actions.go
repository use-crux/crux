package screens

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

// drillExperiment emits a NavigateRequest staging the focused baseline's
// source experiment id so the Experiments screen opens with it selected.
func (s *Baselines) drillExperiment() tea.Cmd {
	cur := s.currentBaseline()
	if cur == nil || cur.ExperimentID == "" {
		return nil
	}
	expID := cur.ExperimentID
	return func() tea.Msg {
		return NavigateRequest{NavID: "experiments", Kind: "experiment", ID: expID}
	}
}

func (s *Baselines) replaceBaseline(c DataClient) tea.Cmd {
	cur := s.currentBaseline()
	if cur == nil || c == nil || cur.ExperimentID == "" {
		return nil
	}
	baselineID := cur.BaselineID
	experimentID := cur.ExperimentID
	variant := cur.VariantName
	return func() tea.Msg {
		res, err := c.PromoteBaseline(context.Background(), experimentID, variant, baselineID)
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return baselineReplacedMsg{result: res}
	}
}

type baselineReplacedMsg struct {
	result api.QualityPromoteResult
}

// exportBaseline writes the focused record to
// ~/.crux/exports/baseline-{id}.json.
func (s *Baselines) exportBaseline() tea.Cmd {
	cur := s.currentBaseline()
	if cur == nil {
		return nil
	}
	rec := *cur
	return func() tea.Msg {
		home, err := os.UserHomeDir()
		if err != nil {
			return dataErrMsg(err.Error())
		}
		dir := filepath.Join(home, ".crux", "exports")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return dataErrMsg(err.Error())
		}
		path := filepath.Join(dir, "baseline-"+truncate(rec.BaselineID, 32)+".json")
		body, err := json.MarshalIndent(rec, "", "  ")
		if err != nil {
			return dataErrMsg(err.Error())
		}
		if err := os.WriteFile(path, body, 0o644); err != nil {
			return dataErrMsg(err.Error())
		}
		return baselineExportedMsg{baselineID: rec.BaselineID, path: path}
	}
}

type baselineExportedMsg struct {
	baselineID string
	path       string
}
