package screens

import (
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// RunRow is one stable, selectable row in the Runs span hierarchy. Runs owns
// expansion policy; ListPane owns selection and viewport movement.
type RunRow struct {
	ID   string
	Span api.InspectRunSpan
	// Activity retains the exact direct observability node behind this row.
	// Synthetic legacy rows may leave it zero-valued.
	Activity    api.ObservabilityRunDetailNode
	Depth       int
	Expandable  bool
	Expanded    bool
	ExpansionID string
}

// FlattenRun projects spans into stable hierarchy rows without retaining
// cursor or expansion state. Duplicate groups use their source group key as
// expansion identity, so refreshes may change the representative row without
// resetting workflow-owned expansion state.
func FlattenRun(spans []api.InspectRunSpan, expanded map[string]bool) []RunRow {
	groupCounts := make(map[string]int)
	groupDurations := make(map[string]float64)
	groupHasDuration := make(map[string]bool)
	for _, span := range spans {
		key := duplicateGroupKey(span)
		if key == "" {
			continue
		}
		groupCounts[key]++
		if span.DurationMs != nil {
			groupDurations[key] += *span.DurationMs
			groupHasDuration[key] = true
		}
	}

	depths := runSpanDepths(spans)
	byID := make(map[string]api.InspectRunSpan, len(spans))
	collapsedParents := make(map[string]bool)
	for _, span := range spans {
		byID[span.ID] = span
		key := duplicateGroupKey(span)
		if key != "" && groupCounts[key] > 1 && !expanded[key] {
			collapsedParents[span.ID] = true
		}
	}
	emitted := make(map[string]bool)
	rows := make([]RunRow, 0, len(spans))
	for _, span := range spans {
		if runSpanHasCollapsedAncestor(span, byID, collapsedParents) {
			continue
		}
		key := duplicateGroupKey(span)
		if key == "" || groupCounts[key] <= 1 {
			rows = append(rows, runRow(span, depths[span.ID], "", false))
			continue
		}

		expansionID := key
		if expanded[expansionID] {
			rows = append(rows, runRow(span, depths[span.ID], expansionID, true))
			continue
		}
		if emitted[key] {
			continue
		}
		emitted[key] = true
		summary := span
		summary.Name = fmt.Sprintf("+ %d more %s", groupCounts[key], span.Name)
		if groupHasDuration[key] {
			duration := groupDurations[key]
			summary.DurationMs = &duration
		}
		rows = append(rows, runRow(summary, depths[span.ID], expansionID, false))
	}
	return rows
}

func runSpanHasCollapsedAncestor(
	span api.InspectRunSpan,
	byID map[string]api.InspectRunSpan,
	collapsedParents map[string]bool,
) bool {
	seen := make(map[string]bool)
	parentID := span.ParentID
	for parentID != "" && !seen[parentID] {
		if collapsedParents[parentID] {
			return true
		}
		seen[parentID] = true
		parent, ok := byID[parentID]
		if !ok {
			return false
		}
		parentID = parent.ParentID
	}
	return false
}

func runRow(span api.InspectRunSpan, depth int, expansionID string, expanded bool) RunRow {
	return RunRow{
		ID:          span.ID,
		Span:        span,
		Depth:       depth,
		Expandable:  expansionID != "",
		Expanded:    expanded,
		ExpansionID: expansionID,
	}
}

func runSpanDepths(spans []api.InspectRunSpan) map[string]int {
	byID := make(map[string]api.InspectRunSpan, len(spans))
	for _, span := range spans {
		byID[span.ID] = span
	}
	depths := make(map[string]int, len(spans))
	for _, span := range spans {
		seen := map[string]bool{span.ID: true}
		parentID := span.ParentID
		for parentID != "" && !seen[parentID] {
			parent, ok := byID[parentID]
			if !ok {
				break
			}
			seen[parentID] = true
			depths[span.ID]++
			parentID = parent.ParentID
		}
	}
	return depths
}
