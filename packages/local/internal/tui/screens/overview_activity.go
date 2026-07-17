package screens

import "github.com/use-crux/crux/packages/local/internal/api"

func activityFromEvent(ev api.InspectEvent) api.InspectActivityEvent {
	summary := ev.Action
	if ev.Kind != "" {
		summary = ev.Kind + " " + ev.RefID
	}
	return api.InspectActivityEvent{
		Tag:       "InspectActivityEvent",
		Timestamp: ev.Timestamp,
		Kind:      ev.Kind,
		Severity:  ev.Severity,
		Summary:   summary,
		RefID:     ev.RefID,
	}
}

func prependActivity(existing []api.InspectActivityEvent, ev api.InspectActivityEvent, limit int) []api.InspectActivityEvent {
	out := append([]api.InspectActivityEvent{ev}, existing...)
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}
