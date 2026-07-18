package tui

import (
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// navKind maps only unmigrated destinations to their legacy selection-store
// slot. Migrated screens receive record identity through NavTarget instead.
var navKind = map[string]Kind{
	"insights": KindInsight,
}

// NavTarget is the logical destination of a cross-screen drill. Record IDs
// remain exact route parameters; they are not display labels or list offsets.
type NavTarget struct {
	NavID string
	Kind  Kind
	ID    string
}

// Location is one logical navigation-history entry. It deliberately excludes
// resource payloads so Back always renders the screen's current data.
type Location struct {
	Target      NavTarget
	FocusedPane string
	SelectedIDs map[string]string
	Anchors     map[string]string
}

// gotoTarget routes a drill directly into a destination that owns record
// focus. The legacy selection store remains only as a fallback for screens
// that have not adopted FocusScreen yet.
func (w *Workbench) gotoTarget(target NavTarget) tea.Cmd {
	if target.NavID == "" {
		return nil
	}
	dest, ok := w.screens[target.NavID]
	if !ok {
		return nil
	}
	w.rememberCurrentLocation(target)

	directFocus := false
	if target.Kind != "" && target.ID != "" {
		if focusable, ok := dest.(screens.FocusScreen); ok {
			focusable.Focus(string(target.Kind), target.ID)
			directFocus = true
		} else {
			w.SetSelection(target.Kind, target.ID)
		}
	}

	return w.activateTarget(target, directFocus)
}

func (w *Workbench) gotoNav(id string) tea.Cmd {
	dest, ok := w.screens[id]
	if !ok {
		return nil
	}
	if id == w.activeNav {
		return nil
	}
	target := NavTarget{NavID: id}
	w.rememberCurrentLocation(target)
	if kind, hasKind := navKind[id]; hasKind {
		if recID := w.GetSelection(kind); recID != "" {
			target.Kind = kind
			target.ID = recID
			if focusable, ok := dest.(screens.FocusScreen); ok {
				focusable.Focus(string(kind), recID)
			}
		}
	}
	return w.activateTarget(target, false)
}

func (w *Workbench) activateTarget(target NavTarget, forceInit bool) tea.Cmd {
	dest, ok := w.screens[target.NavID]
	if !ok {
		return nil
	}
	stale := w.stale[target.NavID]
	needsInit := forceInit || !w.initialized[target.NavID] || (stale != nil && !stale.Empty())
	w.activeNav = target.NavID
	w.activeTarget = target
	delete(w.stale, target.NavID)
	if !needsInit {
		return nil
	}
	w.initialized[target.NavID] = true
	return dest.Init(w.client)
}

func (w *Workbench) rememberCurrentLocation(next NavTarget) {
	if next == w.activeTarget {
		return
	}
	w.history = append(w.history, w.captureLocation())
}

func (w *Workbench) captureLocation() Location {
	location := Location{Target: w.activeTarget}
	if location.Target.NavID == "" {
		location.Target.NavID = w.activeNav
	}
	if screen, ok := w.activeScreen().(screens.LocationScreen); ok {
		owned := screen.CaptureLocation()
		location.FocusedPane = owned.FocusedPane
		location.SelectedIDs = cloneStringMap(owned.SelectedIDs)
		location.Anchors = cloneStringMap(owned.Anchors)
	}
	return location
}

func (w *Workbench) goBack() tea.Cmd {
	if len(w.history) == 0 {
		return nil
	}
	last := len(w.history) - 1
	location := w.history[last]
	w.history = w.history[:last]
	cmd := w.activateTarget(location.Target, false)
	if screen, ok := w.activeScreen().(screens.LocationScreen); ok {
		screen.RestoreLocation(screens.ScreenLocation{
			FocusedPane: location.FocusedPane,
			SelectedIDs: cloneStringMap(location.SelectedIDs),
			Anchors:     cloneStringMap(location.Anchors),
		})
	}
	return cmd
}

func cloneStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
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
