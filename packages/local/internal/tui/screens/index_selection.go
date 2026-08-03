package screens

import (
	"time"

	tea "charm.land/bubbletea/v2"
)

const indexSelectionIntentDelay = 35 * time.Millisecond

var indexSelectionNow = time.Now

type indexSelectionIntentMsg struct{ intent uint64 }

// scheduleSelectionDetail keeps cursor movement synchronous but defers the
// expensive definition document and activity read until a movement burst has
// reached its final row.
func (s *Index) scheduleSelectionDetail() tea.Cmd {
	s.selectionMovedAt = indexSelectionNow()
	if s.selectionPending {
		return nil
	}
	s.selectionPending = true
	s.selectionIntent++
	return indexSelectionIntentTick(indexSelectionIntentDelay, s.selectionIntent)
}

func indexSelectionIntentTick(delay time.Duration, intent uint64) tea.Cmd {
	return tea.Tick(delay, func(time.Time) tea.Msg {
		return indexSelectionIntentMsg{intent: intent}
	})
}
