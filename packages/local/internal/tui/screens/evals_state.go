package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
)

func (s *Evals) selectedEvalID() string {
	item, _, ok := s.catalog.Selected()
	if !ok {
		return ""
	}
	return item.ID
}

func (s *Evals) selectedObservedRunID() string {
	cell := s.run.cell(s.cellRow, s.cellColumn)
	if len(cell.RunIDs) == 0 {
		return ""
	}
	return cell.RunIDs[0]
}

func (s *Evals) setFocus(focus evalsFocus) {
	s.focus = focus
	s.catalog.SetFocused(focus == evalsFocusCatalog)
	s.detail.SetFocused(focus == evalsFocusGrid)
}

func (s *Evals) syncSelection() {
	evalID := s.selectedEvalID()
	if evalID == "" {
		s.selectedRunID = ""
		s.run = evalRunItem{}
		s.syncDetail(false)
		return
	}
	history := s.historyForEval(evalID)
	if !containsEvalRun(history, s.selectedRunID) {
		s.selectedRunID = ""
		if len(history) > 0 {
			s.selectedRunID = history[0].RunID
		}
		s.run = evalRunItem{}
		s.cellRow, s.cellColumn = 0, 0
	}
	s.syncDetail(false)
}

func (s *Evals) ensureSelectedRun(ctx context.Context, client DataClient) tea.Cmd {
	if s.selectedRunID == "" || s.run.RunID == s.selectedRunID {
		return nil
	}
	if s.runResource.Snapshot().Token.Owner == evalRunOwner(s.selectedRunID) {
		return nil
	}
	return s.fetchSelectedRun(ctx, client, 0)
}

func (s *Evals) historyForEval(evalID string) []evalRunItem {
	history := make([]evalRunItem, 0)
	for _, run := range s.runs {
		if run.EvalID == evalID {
			history = append(history, run)
		}
	}
	return history
}

func containsEvalRun(runs []evalRunItem, id string) bool {
	for _, run := range runs {
		if run.RunID == id {
			return true
		}
	}
	return false
}

func sanitizeEvals(value string) string { return kit.SanitizeInline(value) }
