package tui

import (
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// navKind maps a destination to the primary record kind its screen can focus.
// Per the approved 2026-07-16 TUI stabilization design, record selection is
// offered only to screens that implement the optional FocusScreen capability.
var navKind = map[string]Kind{
	"insights": KindInsight,
	"runs":     KindRun,
}

func (w *Workbench) gotoNav(id string) tea.Cmd {
	dest, ok := w.screens[id]
	if !ok {
		return nil
	}
	stale := w.stale[id]
	needsInit := !w.initialized[id] || (stale != nil && !stale.Empty())
	w.activeNav = id
	delete(w.stale, id)
	if kind, hasKind := navKind[id]; hasKind {
		if recID := w.GetSelection(kind); recID != "" {
			if focusable, ok := dest.(screens.FocusScreen); ok {
				focusable.Focus(string(kind), recID)
			}
		}
	}
	if !needsInit {
		return nil
	}
	w.initialized[id] = true
	return dest.Init(w.client)
}

func (w *Workbench) navWithCounts() []shell.NavItem {
	items := w.navigationItems()
	for i := range items {
		if count, ok := w.counts[items[i].ID]; ok {
			items[i].Count = count
			items[i].Show = true
		}
	}
	return items
}

func (w *Workbench) navigationItems() []shell.NavItem {
	items := make([]shell.NavItem, 0, len(shell.DefaultNav))
	for _, item := range shell.DefaultNav {
		if _, mounted := w.screens[item.ID]; mounted {
			items = append(items, item)
		}
	}
	return items
}
