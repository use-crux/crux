package screens

import (
	"encoding/json"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func projectOverviewActivity(events []api.InspectActivityEvent) []api.InspectActivityEvent {
	projected := make([]api.InspectActivityEvent, 0, len(events))
	lastKey := ""
	for _, event := range events {
		if isNoiseEvent(event) {
			continue
		}
		key := overviewActivityKey(event)
		if key == lastKey {
			continue
		}
		lastKey = key
		projected = append(projected, event)
	}
	return projected
}

func overviewActivityKey(event api.InspectActivityEvent) string {
	return event.Kind + "|" + event.RefID
}

func activityFromEvent(ev api.InspectEvent) api.InspectActivityEvent {
	if strings.EqualFold(ev.Action, "activity") && len(ev.Payload) > 0 {
		var activity api.InspectActivityEvent
		if err := json.Unmarshal(ev.Payload, &activity); err == nil &&
			activity.Tag == "InspectActivityEvent" && activity.Timestamp != 0 {
			return activity
		}
	}
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
