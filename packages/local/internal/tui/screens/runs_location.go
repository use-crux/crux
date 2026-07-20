package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

type pendingRunsLocation struct {
	location ScreenLocation
	token    resource.RequestToken
}

// CaptureLocation returns Runs' logical pane and stable run/span identities.
// The run list and detail payload remain live screen-owned data.
func (s *Runs) CaptureLocation() ScreenLocation {
	return ScreenLocation{
		FocusedPane: runsPaneID(s.focus),
		SelectedIDs: map[string]string{
			"run":  s.SelectedRunID(),
			"span": s.SelectedSpanID(),
		},
		Anchors: map[string]string{
			"runs":        s.runList.Anchor(),
			"waterfall":   s.spanList.Anchor(),
			"span-detail": encodeDocumentAnchor(s.spanDocument),
		},
	}
}

// RestoreLocation restores Runs focus and selections against its current
// resource data. Missing identities fall back through the screen's normal
// list/detail reconciliation rather than resurrecting historical payloads.
func (s *Runs) RestoreLocation(location ScreenLocation) {
	previousRunID := s.SelectedRunID()
	if id := location.SelectedIDs["run"]; id != "" {
		s.runList.Select(id)
	}
	changedRun := previousRunID != s.SelectedRunID()
	if changedRun {
		s.detailResource.Cancel()
		s.diagnosis = nil
		s.spanList.SetItems(nil)
		s.spanDocument.SetContent("", "")
	}
	if id := location.SelectedIDs["span"]; !changedRun && id != "" && s.hasSpan(id) {
		s.syncSpanRows()
		s.spanList.Select(id)
	}
	if focus, ok := runsFocusByID(location.FocusedPane); ok {
		s.setFocus(focus)
	}
	s.runList.RestoreAnchor(location.Anchors["runs"])
	s.spanList.RestoreAnchor(location.Anchors["waterfall"])
	restoreDocumentAnchor(s.spanDocument, location.Anchors["span-detail"])
}

// RestoreLocationRefresh restores immediately resolvable list state and, when
// the selected run changed, fetches its current detail before applying the
// captured span and document anchors.
func (s *Runs) RestoreLocationRefresh(ctx context.Context, location ScreenLocation, client DataClient) tea.Cmd {
	s.RestoreLocation(location)
	selectedID := s.SelectedRunID()
	if selectedID == "" || s.selectedDetailIsCurrent() {
		return nil
	}
	if client == nil {
		return nil
	}
	cmd, token := s.beginRunDetailFetch(ctx, client, selectedID)
	s.pendingLocation = &pendingRunsLocation{
		location: cloneScreenLocation(location),
		token:    token,
	}
	return cmd
}

func (s *Runs) restorePendingLocation(token resource.RequestToken) {
	if s.pendingLocation == nil {
		return
	}
	pending := *s.pendingLocation
	s.pendingLocation = nil
	if !sameRunsLocationRequest(pending.token, token) {
		return
	}
	location := pending.location
	if location.SelectedIDs["run"] != s.SelectedRunID() {
		return
	}
	s.RestoreLocation(location)
}

func sameRunsLocationRequest(left, right resource.RequestToken) bool {
	return left.Owner == right.Owner && left.Request == right.Request
}

func cloneScreenLocation(location ScreenLocation) ScreenLocation {
	return ScreenLocation{
		FocusedPane: location.FocusedPane,
		SelectedIDs: cloneLocationMap(location.SelectedIDs),
		Anchors:     cloneLocationMap(location.Anchors),
	}
}

func cloneLocationMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func (s *Runs) hasSpan(id string) bool {
	for _, row := range s.allTimelineRows() {
		if row.ID == id {
			return true
		}
	}
	return false
}

func runsPaneID(focus runsFocus) string {
	switch focus {
	case focusWaterfall:
		return "waterfall"
	case focusSpanDetail:
		return "span-detail"
	default:
		return "runs"
	}
}

func runsFocusByID(id string) (runsFocus, bool) {
	switch id {
	case "runs":
		return focusRuns, true
	case "waterfall":
		return focusWaterfall, true
	case "span-detail":
		return focusSpanDetail, true
	default:
		return focusRuns, false
	}
}
