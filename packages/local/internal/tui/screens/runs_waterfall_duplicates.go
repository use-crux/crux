package screens

import (
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func (s *Runs) visibleSpans() []api.InspectRunSpan {
	if s.detail == nil || len(s.detail.Spans) == 0 {
		return nil
	}
	counts := s.duplicateGroupCounts()
	emitted := map[string]bool{}
	out := make([]api.InspectRunSpan, 0, len(s.detail.Spans))
	for _, span := range s.detail.Spans {
		key := duplicateGroupKey(span)
		if key == "" || counts[key] <= 1 || s.expandedDups[key] {
			out = append(out, span)
			continue
		}
		if emitted[key] {
			continue
		}
		emitted[key] = true
		summary := span
		summary.Name = fmt.Sprintf("+ %d more %s", counts[key], span.Name)
		summary.DurationMs = s.duplicateGroupDuration(key)
		out = append(out, summary)
	}
	return out
}

func (s *Runs) toggleSelectedDuplicateGroup() bool {
	if s.detail == nil {
		return false
	}
	var selected *api.InspectRunSpan
	for _, span := range s.visibleSpans() {
		if span.ID == s.selSpan {
			copy := span
			selected = &copy
			break
		}
	}
	if selected == nil {
		return false
	}
	key := duplicateGroupKey(*selected)
	if key == "" || s.duplicateGroupCounts()[key] <= 1 {
		return false
	}
	if s.expandedDups == nil {
		s.expandedDups = map[string]bool{}
	}
	s.expandedDups[key] = !s.expandedDups[key]
	return true
}

func (s *Runs) duplicateGroupCounts() map[string]int {
	counts := map[string]int{}
	if s.detail == nil {
		return counts
	}
	for _, span := range s.detail.Spans {
		if key := duplicateGroupKey(span); key != "" {
			counts[key]++
		}
	}
	return counts
}

func (s *Runs) duplicateGroupDuration(key string) *float64 {
	if s.detail == nil {
		return nil
	}
	total := 0.0
	seen := false
	for _, span := range s.detail.Spans {
		if duplicateGroupKey(span) != key || span.DurationMs == nil {
			continue
		}
		total += *span.DurationMs
		seen = true
	}
	if !seen {
		return nil
	}
	return &total
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

// renderTraceSummary fills the rest of the waterfall pane when a trace has
// only a couple of spans. Surfaces input + output previews and a few
// counters so the pane reads as intentional rather than empty.
