package screens

import (
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func runStatusFailed(status string) bool {
	switch strings.ToLower(status) {
	case "error", "errored", "fail", "failed", "blocked":
		return true
	default:
		return false
	}
}

func (s *Runs) failingSpanIDs() []string {
	if s.diagnosis == nil {
		return nil
	}
	selectable := selectableFailureTargets(s.diagnosis)
	seen := map[string]bool{}
	ids := make([]string, 0, len(s.diagnosis.Failures))
	for _, failure := range s.diagnosis.Failures {
		target := selectable[failure.NodeID]
		if target != "" && !seen[target] {
			seen[target] = true
			ids = append(ids, target)
		}
	}
	for _, row := range s.diagnosis.Timeline {
		status := firstNonEmpty(row.Activity.Status, row.Span.Status)
		if runStatusFailed(status) && !seen[row.ID] {
			seen[row.ID] = true
			ids = append(ids, row.ID)
		}
	}
	return ids
}

func selectableFailureTargets(diagnosis *RunDiagnosis) map[string]string {
	targets := make(map[string]string, len(diagnosis.Timeline))
	for _, row := range diagnosis.Timeline {
		targets[row.ID] = row.ID
	}
	var visit func(api.ObservabilityRunDetailNode)
	visit = func(node api.ObservabilityRunDetailNode) {
		ownerID := firstNonEmpty(node.SpanID, node.ID)
		if targets[ownerID] != "" {
			for _, detail := range node.Details {
				targets[diagnosisNodeID(detail.SpanID, detail.ID)] = ownerID
			}
		}
		for _, child := range node.Children {
			visit(child)
		}
	}
	visit(diagnosis.Raw.Root)
	return targets
}

func (s *Runs) failurePathRows() []RunRow {
	if s.diagnosis == nil {
		return nil
	}
	included := map[string]bool{}
	parents := make(map[string]string, len(s.diagnosis.Timeline))
	for _, row := range s.diagnosis.Timeline {
		parents[row.ID] = row.Span.ParentID
	}
	for _, id := range s.failingSpanIDs() {
		for id != "" && !included[id] {
			included[id] = true
			id = parents[id]
		}
	}
	rows := make([]RunRow, 0, len(included))
	for _, row := range s.diagnosis.Timeline {
		if included[row.ID] {
			rows = append(rows, row)
		}
	}
	return rows
}

func (s *Runs) hasDescendantFailure() bool {
	if s.diagnosis == nil || len(s.diagnosis.Timeline) == 0 {
		return false
	}
	rootID := s.diagnosis.Timeline[0].ID
	for _, id := range s.failingSpanIDs() {
		if id != "" && id != rootID {
			return true
		}
	}
	return false
}

func (s *Runs) stepFailure(delta int) {
	ids := s.failingSpanIDs()
	if len(ids) == 0 {
		return
	}
	current := 0
	for index, id := range ids {
		if id == s.SelectedSpanID() {
			current = index
			break
		}
	}
	next := (current + delta + len(ids)) % len(ids)
	s.selectFailure(next)
	s.setFocus(focusWaterfall)
}

func (s *Runs) selectFailure(index int) {
	ids := s.failingSpanIDs()
	if len(ids) == 0 {
		return
	}
	if index < 0 || index >= len(ids) {
		index = 0
	}
	s.spanList.Select(ids[index])
}

func (s *Runs) toggleTriageRows() {
	if s.diagnosis == nil || !runStatusFailed(s.diagnosis.Summary.Status) {
		return
	}
	selected := s.SelectedSpanID()
	s.showAllSpans = !s.showAllSpans
	s.syncSpanRows()
	if selected != "" {
		s.spanList.Select(selected)
	}
}
