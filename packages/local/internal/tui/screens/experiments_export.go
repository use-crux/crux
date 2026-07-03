package screens

import (
	"encoding/json"
	"os"
	"path/filepath"

	tea "charm.land/bubbletea/v2"
)

type experimentExportedMsg struct {
	experimentID string
	path         string
}

func (s *Experiments) exportExperiment() tea.Cmd {
	if s.detail == nil {
		return nil
	}
	rec := *s.detail
	return func() tea.Msg {
		home, err := os.UserHomeDir()
		if err != nil {
			return dataErrMsg(err.Error())
		}
		dir := filepath.Join(home, ".crux", "exports")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return dataErrMsg(err.Error())
		}
		path := filepath.Join(dir, "experiment-"+truncate(rec.ExperimentID, 32)+".json")
		body, err := json.MarshalIndent(rec, "", "  ")
		if err != nil {
			return dataErrMsg(err.Error())
		}
		if err := os.WriteFile(path, body, 0o644); err != nil {
			return dataErrMsg(err.Error())
		}
		return experimentExportedMsg{experimentID: rec.ExperimentID, path: path}
	}
}
