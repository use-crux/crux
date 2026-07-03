package screens

import "github.com/use-crux/crux/packages/local/internal/api"

func activityFromEvent(ev api.QualityEvent) api.QualityActivityEvent {
	summary := ev.Action
	if ev.Kind != "" {
		summary = ev.Kind + " " + ev.RefID
	}
	return api.QualityActivityEvent{
		Tag:       "QualityActivityEvent",
		Timestamp: ev.Timestamp,
		Kind:      ev.Kind,
		Severity:  ev.Severity,
		Summary:   summary,
		RefID:     ev.RefID,
	}
}

func prependActivity(existing []api.QualityActivityEvent, ev api.QualityActivityEvent, limit int) []api.QualityActivityEvent {
	out := append([]api.QualityActivityEvent{ev}, existing...)
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}
