package screens

import (
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

func resourceStateMessage(state resource.ResourceState, err error, label string) string {
	switch state {
	case resource.ResourceFailed:
		if err != nil {
			return "failed " + label + ": " + kit.SanitizeInline(err.Error())
		}
		return "failed " + label
	case resource.ResourceLoading:
		return "loading " + label + "…"
	case resource.ResourceEmpty:
		return "no " + label
	default:
		return "waiting for " + label + "…"
	}
}

func resourceStatus[T any](snapshot resource.Snapshot[T]) string {
	if snapshot.State == resource.ResourceDegraded {
		if snapshot.Err != nil {
			return "degraded · " + kit.SanitizeInline(snapshot.Err.Error())
		}
		return "degraded"
	}
	if snapshot.Refreshing {
		return "refreshing"
	}
	return ""
}

func appendResourceStatus(meta, status string) string {
	if status == "" {
		return meta
	}
	if meta == "" {
		return status
	}
	return fmt.Sprintf("%s · %s", status, meta)
}

func (o *Overview) overviewSummary() api.InspectOverviewRecord {
	return o.summaryResource.Snapshot().Value
}

func (o *Overview) insightRows() []api.InspectInsightRecord {
	return o.insightsResource.Snapshot().Value
}

func (o *Overview) runRows() []api.InspectRunRecord {
	return o.runsResource.Snapshot().Value
}

func (o *Overview) activityRows() []api.InspectActivityEvent {
	authoritative := o.activityResource.Snapshot().Value
	return mergeOverviewActivity(o.activityOverlay, authoritative, len(o.activityOverlay)+len(authoritative))
}

func (o *Overview) projectedActivityRows() []api.InspectActivityEvent {
	return projectOverviewActivity(o.activityRows())
}

func (o *Overview) clampActivityScroll() {
	o.activityScroll = min(o.activityScroll, max(0, len(o.projectedActivityRows())-1))
}

func (o *Overview) prependLiveActivities(events []api.InspectEvent, limit int) int {
	projected := projectOverviewActivity(o.activityRows())
	topKey := ""
	if len(projected) > 0 {
		topKey = overviewActivityKey(projected[0])
	}
	inserted := 0
	for _, event := range events {
		activity := activityFromEvent(event)
		key := overviewActivityKey(activity)
		if isNoiseEvent(activity) || key == topKey {
			continue
		}
		o.activityOverlay = prependActivity(o.activityOverlay, activity, limit)
		topKey = key
		inserted++
	}
	if inserted == 0 {
		return 0
	}
	o.clampActivityScroll()
	return inserted
}

func (o *Overview) reconcileActivityOverlay(authoritative []api.InspectActivityEvent) {
	seen := make(map[string]struct{}, len(authoritative))
	for _, event := range authoritative {
		seen[overviewActivityOccurrenceKey(event)] = struct{}{}
	}
	pending := o.activityOverlay[:0]
	for _, event := range o.activityOverlay {
		if _, reconciled := seen[overviewActivityOccurrenceKey(event)]; !reconciled {
			pending = append(pending, event)
		}
	}
	o.activityOverlay = pending
}

func mergeOverviewActivity(overlay, authoritative []api.InspectActivityEvent, limit int) []api.InspectActivityEvent {
	merged := make([]api.InspectActivityEvent, 0, min(limit, len(overlay)+len(authoritative)))
	seen := make(map[string]struct{}, len(overlay)+len(authoritative))
	for _, source := range [][]api.InspectActivityEvent{overlay, authoritative} {
		for _, event := range source {
			key := overviewActivityOccurrenceKey(event)
			if _, duplicate := seen[key]; duplicate {
				continue
			}
			seen[key] = struct{}{}
			merged = append(merged, event)
			if len(merged) == limit {
				return merged
			}
		}
	}
	return merged
}

func overviewActivityOccurrenceKey(event api.InspectActivityEvent) string {
	if event.Timestamp != 0 {
		return fmt.Sprintf("%d|%s", event.Timestamp, overviewActivityKey(event))
	}
	return fmt.Sprintf("0|%s|%s|%s", overviewActivityKey(event), event.Severity, event.Summary)
}
