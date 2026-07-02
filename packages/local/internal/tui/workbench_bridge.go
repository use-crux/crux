package tui

import (
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
)

func (w *Workbench) handleBridgeBatch(batch bridge.Batch) tea.Cmd {
	changed := batch.Changed
	if changed == nil {
		changed = bridge.NewDomains()
	}
	w.markInactiveStale(changed)

	cmds := make([]tea.Cmd, 0, len(batch.Quality)+2)
	active := w.activeScreen()
	if active.Interested(changed) {
		if len(batch.Quality) > 0 {
			for _, ev := range batch.Quality {
				cmds = append(cmds, active.Update(ev, w.client))
			}
		} else if batch.IndexChanged {
			cmds = append(cmds, active.Update(api.QualityEvent{
				Tag:       "QualityEvent",
				Timestamp: timeNowMs(),
				Kind:      string(bridge.DomainIndex),
				Action:    "changed",
			}, w.client))
		}
	}
	if changed.Has(bridge.DomainContext) {
		cmds = append(cmds, w.fetchContext())
	}
	return tea.Batch(cmds...)
}

func (w *Workbench) markInactiveStale(changed bridge.Domains) {
	if changed.Empty() {
		return
	}
	for id, screen := range w.screens {
		if id == w.activeNav || !screen.Interested(changed) {
			continue
		}
		if w.stale[id] == nil {
			w.stale[id] = bridge.NewDomains()
		}
		w.stale[id].AddAll(changed)
	}
}
