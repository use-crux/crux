package tui

import (
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
)

func (w *Workbench) routeOwnedResourceResult(msg tea.Msg) (tea.Cmd, bool) {
	result, ok := msg.(screens.OwnedResourceResult)
	if !ok {
		return nil, false
	}
	owner := result.ResourceOwner()
	ownerScreen, exists := w.screens[owner.Screen]
	if !exists {
		return nil, true
	}
	cmd := ownerScreen.Update(w.ctx, msg, w.client)
	if owner.Screen != w.activeNav {
		// The departed screen already canceled this request. Delivering the
		// terminal result lets its Resource reject it by request identity;
		// dependent work remains deferred until activation.
		return nil, true
	}
	w.refreshCounts()
	return cmd, true
}

func (w *Workbench) deactivateActiveResources(nextScreenID string) {
	if w.activeNav == "" || w.activeNav == nextScreenID {
		return
	}
	active, ok := w.activeScreen().(screens.ResourceScreen)
	if !ok {
		return
	}
	invalidations := active.Deactivate()
	if len(invalidations) == 0 {
		return
	}
	if w.invalidated[w.activeNav] == nil {
		w.invalidated[w.activeNav] = bridge.Invalidations{}
	}
	w.invalidated[w.activeNav].AddAll(invalidations)
}
