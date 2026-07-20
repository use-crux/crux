package tui

import (
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
)

func (w *Workbench) handleBridgeBatch(batch bridge.Batch) tea.Cmd {
	changed := batch.Changed
	if changed == nil {
		changed = bridge.NewDomains()
	}
	invalidations := invalidationsForBatch(batch)
	w.markInactiveResourcesInvalid(invalidations)
	w.markInactiveStale(changed)

	cmds := make([]tea.Cmd, 0, len(batch.Inspect)+2)
	active := w.activeScreen()
	if screen, ok := active.(screens.ResourceScreen); ok {
		if events := activityInspectEvents(batch.Inspect); len(events) > 0 {
			cmds = append(cmds, active.Update(w.ctx, screens.LiveEvents{Events: events}, w.client))
		}
		cmds = append(cmds, screen.Refresh(w.ctx, w.client, invalidations))
		if changed.Has(bridge.DomainContext) {
			cmds = append(cmds, w.fetchContext())
		}
		return tea.Batch(cmds...)
	}
	legacy, legacyAdapted := active.(screens.LegacyInvalidationScreen)
	if legacyAdapted && legacy.Interested(changed) {
		if len(batch.Inspect) > 0 {
			for _, ev := range batch.Inspect {
				cmds = append(cmds, active.Update(w.ctx, ev, w.client))
			}
		}
	}
	if changed.Has(bridge.DomainContext) {
		cmds = append(cmds, w.fetchContext())
	}
	return tea.Batch(cmds...)
}

func activityInspectEvents(events []api.InspectEvent) []api.InspectEvent {
	activity := make([]api.InspectEvent, 0, len(events))
	for _, event := range events {
		if bridge.DomainsForInspectEvent(event).Has(bridge.DomainActivity) {
			activity = append(activity, event)
		}
	}
	return activity
}

func (w *Workbench) markInactiveStale(changed bridge.Domains) {
	if changed.Empty() {
		return
	}
	for id, screen := range w.screens {
		legacy, ok := screen.(screens.LegacyInvalidationScreen)
		if id == w.activeNav || !ok || !legacy.Interested(changed) {
			continue
		}
		if w.legacyStale[id] == nil {
			w.legacyStale[id] = bridge.NewDomains()
		}
		w.legacyStale[id].AddAll(changed)
	}
}

func (w *Workbench) markInactiveResourcesInvalid(invalidations bridge.Invalidations) {
	if len(invalidations) == 0 {
		return
	}
	for id, screen := range w.screens {
		if id == w.activeNav {
			continue
		}
		if _, migrated := screen.(screens.ResourceScreen); !migrated {
			continue
		}
		affected := invalidationsForScreen(id, invalidations)
		if len(affected) == 0 {
			continue
		}
		if w.invalidated[id] == nil {
			w.invalidated[id] = bridge.Invalidations{}
		}
		w.invalidated[id].AddAll(affected)
	}
}
