package devtools

import (
	"sort"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

func applyObservedTaskActivity(
	plans map[string]*planDetail,
	taskListToPlan map[string]string,
	taskByPlan map[string]map[string]*planTask,
	activity []observability.ResourceActivity,
) {
	sort.Slice(activity, func(i, j int) bool {
		return activity[i].StartedAt < activity[j].StartedAt
	})

	for _, item := range activity {
		attrs := rawMap(item.Attributes)
		preview := rawMap(firstArtifactPreview(item.Artifacts))
		operation := nonEmpty(stringValue(preview, "operation", ""), stringValue(attrs, "operation", operationFromActivity(item)))
		timestamp := observedTaskTimestamp(item)
		taskListID := nonEmpty(stringValue(preview, "taskListId", ""), stringValue(attrs, "taskListId", item.ResourceID))
		if taskListID == "" {
			continue
		}
		planID := nonEmpty(stringValue(preview, "planId", ""), stringValue(attrs, "planId", taskListToPlan[taskListID]))
		if planID != "" {
			taskListToPlan[taskListID] = planID
		}

		switch operation {
		case "tasklist.create", "tasklist.discard":
			applyObservedTaskListOperation(plans, taskListToPlan, taskListID, planID, item, preview, attrs, operation, timestamp)
		case "add", "update", "remove":
			applyObservedTaskOperation(plans, taskListToPlan, taskByPlan, taskListID, planID, item, preview, attrs, operation, timestamp)
		}
	}
}

func applyObservedTaskListOperation(
	plans map[string]*planDetail,
	taskListToPlan map[string]string,
	taskListID string,
	planID string,
	item observability.ResourceActivity,
	preview map[string]any,
	attrs map[string]any,
	operation string,
	timestamp int64,
) {
	planID = nonEmpty(planID, nonEmpty(taskListToPlan[taskListID], "unassigned"))
	taskListToPlan[taskListID] = planID
	detail := ensurePlan(plans, planID)
	touchPlanDetail(detail, timestamp)

	kind := "tasklist.created"
	if operation == "tasklist.discard" {
		kind = "tasklist.discarded"
	}
	detail.Events = append(detail.Events, planEvent{
		EventID:   eventID("tasklist", item.TraceID, timestamp, nonEmpty(item.SpanID, taskListID)),
		Kind:      kind,
		Agent:     stringValue(preview, "agent", stringValue(attrs, "agent", "")),
		Label:     kind,
		Timestamp: timestamp,
		Payload:   observedPayload(preview, attrs),
	})
}

func applyObservedTaskOperation(
	plans map[string]*planDetail,
	taskListToPlan map[string]string,
	taskByPlan map[string]map[string]*planTask,
	taskListID string,
	planID string,
	item observability.ResourceActivity,
	preview map[string]any,
	attrs map[string]any,
	operation string,
	timestamp int64,
) {
	taskID := nonEmpty(stringValue(preview, "taskId", ""), stringValue(attrs, "taskId", item.ResourceID))
	if taskID == "" {
		return
	}
	planID = nonEmpty(planID, nonEmpty(taskListToPlan[taskListID], "unassigned"))
	detail := ensurePlan(plans, planID)
	touchPlanDetail(detail, timestamp)
	task := ensureObservedPlanTask(taskByPlan, planID, taskID, detail)

	task.Label = nonEmpty(stringValue(preview, "label", ""), nonEmpty(task.Label, taskID))
	task.TraceID = item.TraceID
	task.SpanID = item.SpanID

	switch operation {
	case "add":
		task.Status = normalizeTaskStatus(nonEmpty(stringValue(preview, "status", ""), stringValue(attrs, "status", task.Status)))
		assignee := preview["assignee"]
		if assignee == nil {
			assignee = attrs["assignee"]
		}
		task.Assignee = assigneeLabel(assignee)
	case "update":
		task.Status = normalizeTaskStatus(nonEmpty(stringValue(preview, "status", ""), stringValue(attrs, "status", task.Status)))
		task.ProgressMessage = nonEmpty(stringValue(preview, "progress", ""), stringValue(attrs, "progress", task.ProgressMessage))
		progress := preview["progress"]
		if progress == nil {
			progress = attrs["progress"]
		}
		task.Progress = progressValue(progress, task.Status)
		task.DurationMs = observedDuration(preview, attrs, item)
	case "remove":
		task.Status = "removed"
		removedVersion := maxInt(detail.Version, 1)
		task.RemovedInVersion = &removedVersion
	}

	kind := "task." + operation
	detail.Events = append(detail.Events, planEvent{
		EventID:   eventID("task", item.TraceID, timestamp, nonEmpty(item.SpanID, taskID)),
		Kind:      kind,
		Agent:     stringValue(preview, "agent", stringValue(attrs, "agent", "")),
		Label:     nonEmpty(task.Label, taskID),
		Timestamp: timestamp,
		Payload:   observedPayload(preview, attrs),
	})
}

func ensureObservedPlanTask(
	taskByPlan map[string]map[string]*planTask,
	planID string,
	taskID string,
	detail *planDetail,
) *planTask {
	if taskByPlan[planID] == nil {
		taskByPlan[planID] = map[string]*planTask{}
	}
	if taskByPlan[planID][taskID] == nil {
		taskByPlan[planID][taskID] = &planTask{ID: taskID, Status: "pending", AddedInVersion: maxInt(detail.Version, 1)}
	}
	return taskByPlan[planID][taskID]
}

func observedTaskTimestamp(item observability.ResourceActivity) int64 {
	timestamp := parseUnixMillis(nonEmpty(item.EndedAt, item.StartedAt))
	if timestamp == 0 {
		timestamp = parseUnixMillis(item.StartedAt)
	}
	return timestamp
}

func touchPlanDetail(detail *planDetail, timestamp int64) {
	if timestamp <= 0 {
		return
	}
	detail.LastUpdatedAt = maxInt64(detail.LastUpdatedAt, timestamp)
	if detail.StartedAt == 0 || timestamp < detail.StartedAt {
		detail.StartedAt = timestamp
	}
}

func observedDuration(preview map[string]any, attrs map[string]any, item observability.ResourceActivity) *float64 {
	if duration := floatPointer(preview["durationMs"]); duration != nil {
		return duration
	}
	if duration := floatPointer(attrs["durationMs"]); duration != nil {
		return duration
	}
	if item.DurationMs > 0 {
		duration := item.DurationMs
		return &duration
	}
	return nil
}

func observedPayload(preview map[string]any, attrs map[string]any) map[string]any {
	if len(preview) > 0 {
		return preview
	}
	return attrs
}
