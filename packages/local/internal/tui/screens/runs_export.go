package screens

import (
	"encoding/json"
	"os"
	"path/filepath"

	tea "charm.land/bubbletea/v2"
)

// runExportedMsg is emitted on a successful `e` export. The screen can
// surface a toast referencing the saved path.
type runExportedMsg struct {
	runID string
	path  string
}

// runExportErrMsg is emitted when the export cmd fails (e.g. fs error).
type runExportErrMsg struct{ err string }

// exportRun returns a tea.Cmd that writes the focused run's detail
// record as pretty-printed JSON to ~/.crux/exports/run-{id}.json. No-op
// (returns nil) when nothing is focused.
func (s *Runs) exportRun() tea.Cmd {
	snapshot := s.detailResource.Snapshot()
	if !snapshot.HasValue || s.selRun == "" || snapshot.Value.Run.RunID != s.selRun {
		return nil
	}
	rec := snapshot.Value
	id := s.selRun
	return func() tea.Msg {
		home, err := os.UserHomeDir()
		if err != nil {
			return runExportErrMsg{err: err.Error()}
		}
		dir := filepath.Join(home, ".crux", "exports")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return runExportErrMsg{err: err.Error()}
		}
		path := filepath.Join(dir, "run-"+truncate(id, 12)+".json")
		body, err := json.MarshalIndent(rec, "", "  ")
		if err != nil {
			return runExportErrMsg{err: err.Error()}
		}
		if err := os.WriteFile(path, body, 0o644); err != nil {
			return runExportErrMsg{err: err.Error()}
		}
		return runExportedMsg{runID: id, path: path}
	}
}
