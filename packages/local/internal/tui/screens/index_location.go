package screens

// CaptureLocation returns Index's exact route, pane focus, and logical
// viewport anchors without copying the current Project Index snapshot.
func (s *Index) CaptureLocation() ScreenLocation {
	definitionID := firstNonEmpty(s.unavailableDefinitionID, s.SelectedDefinitionID())
	return ScreenLocation{
		FocusedPane: indexPaneID(s.focus),
		SelectedIDs: map[string]string{"definition": definitionID},
		Anchors: map[string]string{
			"definitions": s.definitions.Anchor(),
			"detail":      encodeDocumentAnchor(s.detail),
		},
	}
}

// RestoreLocation resolves the captured exact ID against current resource data
// and restores logical viewport anchors that still exist.
func (s *Index) RestoreLocation(location ScreenLocation) {
	if id := location.SelectedIDs["definition"]; id != "" {
		s.routedDefinitionID = id
		s.routedDefinitionAnchorPending = true
		s.resolveRoutedDefinition()
	}
	if focus, ok := indexFocusByPaneID(location.FocusedPane); ok {
		s.setFocus(focus)
	}
	s.definitions.RestoreAnchor(location.Anchors["definitions"])
	restoreDocumentAnchor(s.detail, location.Anchors["detail"])
}

func indexPaneID(focus indexFocus) string {
	if focus == indexFocusDetail {
		return "detail"
	}
	return "definitions"
}

func indexFocusByPaneID(id string) (indexFocus, bool) {
	switch id {
	case "definitions":
		return indexFocusDefinitions, true
	case "detail":
		return indexFocusDetail, true
	default:
		return indexFocusDefinitions, false
	}
}
