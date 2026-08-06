package screens

import "github.com/use-crux/crux/packages/local/internal/api"

func (s *Runs) toggleSelectedDuplicateGroup() bool {
	selected, _, ok := s.spanList.Selected()
	if !ok || !selected.Expandable {
		return false
	}
	if s.expandedRows == nil {
		s.expandedRows = map[string]bool{}
	}
	nextExpanded := !selected.Expanded
	s.expandedRows[selected.ExpansionID] = nextExpanded
	targetID := selected.ID
	rows := s.flattenedSpanRows()
	if !nextExpanded {
		for _, row := range rows {
			if row.ExpansionID == selected.ExpansionID {
				targetID = row.ID
				break
			}
		}
	}
	s.spanList.SetItems(rows)
	s.spanList.Select(targetID)
	return true
}

func (s *Runs) flattenedSpanRows() []RunRow {
	if s.diagnosis != nil {
		timeline := s.diagnosis.Timeline
		if !s.showAllSpans && runStatusFailed(s.diagnosis.Summary.Status) {
			timeline = s.failurePathRows()
		}
		spans := make([]api.InspectRunSpan, len(timeline))
		activities := make(map[string]api.ObservabilityRunDetailNode, len(s.diagnosis.Timeline))
		for index, row := range timeline {
			spans[index] = row.Span
			activities[row.ID] = row.Activity
		}
		rows := FlattenRun(spans, s.expandedRows)
		for index := range rows {
			rows[index].Activity = activities[rows[index].ID]
		}
		return rows
	}
	return nil
}

func (s *Runs) syncSpanRows() {
	s.spanList.SetItems(s.flattenedSpanRows())
}

func duplicateGroupKey(span api.InspectRunSpan) string {
	if !span.Duplicate {
		return ""
	}
	if span.DuplicateOfSpanID != "" {
		return span.DuplicateOfSpanID
	}
	return span.ParentID + "\x00" + span.Name
}
