package screens

import (
	"context"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

// drillToSourceRun emits a NavigateRequest staging the feedback's linked
// TraceID so Runs opens with that record focused.
func (s *Feedback) drillToSourceRun() tea.Cmd {
	cur := s.currentFeedback()
	if cur == nil || cur.TraceID == nil || *cur.TraceID == "" {
		return nil
	}
	runID := *cur.TraceID
	return func() tea.Msg {
		return NavigateRequest{NavID: "runs", Kind: "run", ID: runID}
	}
}

func (s *Feedback) dismissFeedback(c DataClient) tea.Cmd {
	cur := s.currentFeedback()
	if cur == nil || c == nil {
		return nil
	}
	id := cur.ID
	return func() tea.Msg {
		rec, err := c.CreateFeedbackAnnotation(context.Background(), api.QualityFeedbackAnnotationPostRequest{
			FeedbackID: id,
			Status:     "dismissed",
		})
		if err != nil {
			return dataErrMsg(err.Error())
		}
		return feedbackAnnotatedMsg(rec)
	}
}

type feedbackAnnotatedMsg api.QualityFeedbackAnnotationRecord

func (s *Feedback) applyAnnotation(rec api.QualityFeedbackAnnotationRecord) {
	if rec.FeedbackID == "" {
		return
	}
	for i := range s.items {
		if s.items[i].ID == rec.FeedbackID {
			if rec.Status != "" {
				s.items[i].Status = rec.Status
			}
			if rec.Expected != nil {
				s.items[i].Expected = rec.Expected
			}
			if len(rec.Tags) > 0 {
				s.items[i].Tags = appendFeedbackTags(s.items[i].Tags, rec.Tags...)
			}
			return
		}
	}
}

func appendFeedbackTags(values []string, nextValues ...string) []string {
	seen := make(map[string]struct{}, len(values)+len(nextValues))
	for _, value := range values {
		seen[value] = struct{}{}
	}
	for _, next := range nextValues {
		if next == "" {
			continue
		}
		if _, ok := seen[next]; ok {
			continue
		}
		values = append(values, next)
		seen[next] = struct{}{}
	}
	return values
}

// cycleStatusFilter advances the status filter through
// open -> resolved -> dismissed -> all -> open.
func (s *Feedback) cycleStatusFilter() {
	switch s.StatusFilter() {
	case "open":
		s.statusFilter = "resolved"
	case "resolved":
		s.statusFilter = "dismissed"
	case "dismissed":
		s.statusFilter = "all"
	default:
		s.statusFilter = "open"
	}
}
