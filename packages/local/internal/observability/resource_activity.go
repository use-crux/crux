package observability

import (
	"context"
	"encoding/json"
	"fmt"
)

const resourceActivityLimit = 500

func (s *Service) ResourceActivity(ctx context.Context, family string) ([]ResourceActivity, error) {
	ctx, cancel := s.queryContext(ctx)
	defer cancel()

	if !isResourceFamily(family) {
		return nil, fmt.Errorf("unsupported observability resource family %q", family)
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			span_id, run_id, ifnull(trace_id, ''), ifnull(family, ''), ifnull(primitive, ''),
			ifnull(name, ''), ifnull(status, ''), ifnull(started_at, ''), ifnull(ended_at, ''),
			ifnull(duration_ms, 0), ifnull(memory_id, ''), ifnull(retriever_id, ''),
			ifnull(prompt_id, ''), ifnull(context_id, ''), ifnull(tool_name, ''),
			attributes_json, metrics_json, error_json
		FROM spans
		WHERE family = ?
		ORDER BY started_at DESC, span_id DESC
		LIMIT ?
	`, family, resourceActivityLimit)
	if err != nil {
		return nil, fmt.Errorf("query observability resource activity %q: %w", family, err)
	}

	var activities []ResourceActivity
	for rows.Next() {
		var activity ResourceActivity
		var memoryID, retrieverID, promptID, contextID, toolName string
		var attributes, metrics, errorJSON []byte
		if err := rows.Scan(
			&activity.SpanID,
			&activity.RunID,
			&activity.TraceID,
			&activity.Family,
			&activity.Primitive,
			&activity.Name,
			&activity.Status,
			&activity.StartedAt,
			&activity.EndedAt,
			&activity.DurationMs,
			&memoryID,
			&retrieverID,
			&promptID,
			&contextID,
			&toolName,
			&attributes,
			&metrics,
			&errorJSON,
		); err != nil {
			return nil, fmt.Errorf("scan observability resource activity %q: %w", family, err)
		}
		activity.Attributes = json.RawMessage(attributes)
		activity.Metrics = json.RawMessage(metrics)
		activity.Error = json.RawMessage(errorJSON)
		activity.ResourceID = resourceIDForFamily(family, activity.Attributes, map[string]string{
			"memoryId":    memoryID,
			"retrieverId": retrieverID,
			"promptId":    promptID,
			"contextId":   contextID,
			"toolName":    toolName,
		})
		activities = append(activities, activity)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate observability resource activity %q: %w", family, err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close observability resource activity rows %q: %w", family, err)
	}

	if len(activities) == 0 {
		return activities, nil
	}
	spanIDs := make([]string, 0, len(activities))
	for _, activity := range activities {
		spanIDs = append(spanIDs, activity.SpanID)
	}
	artifactsBySpan, err := s.listResourceArtifactsBySpan(ctx, spanIDs)
	if err != nil {
		return nil, fmt.Errorf("list observability resource artifacts %q: %w", family, err)
	}
	edgesBySpan, err := s.listResourceEdgesBySpan(ctx, spanIDs)
	if err != nil {
		return nil, fmt.Errorf("list observability resource edges %q: %w", family, err)
	}
	for i := range activities {
		activities[i].Artifacts = artifactsBySpan[activities[i].SpanID]
		activities[i].Edges = edgesBySpan[activities[i].SpanID]
	}
	return activities, nil
}

func isResourceFamily(family string) bool {
	switch family {
	case "memory", "workspace", "plan", "task", "retrieval", "indexing", "ingest", "corpus", "skill", "security", "cost", "feedback":
		return true
	default:
		return false
	}
}

func resourceIDForFamily(family string, attributes json.RawMessage, indexed map[string]string) string {
	switch family {
	case "memory":
		if indexed["memoryId"] != "" {
			return indexed["memoryId"]
		}
		return stringAttribute(attributes, "memoryId")
	case "workspace":
		return stringAttribute(attributes, "workspaceId")
	case "plan":
		return stringAttribute(attributes, "planId")
	case "task":
		if id := stringAttribute(attributes, "taskId"); id != "" {
			return id
		}
		return stringAttribute(attributes, "taskListId")
	case "retrieval":
		if indexed["retrieverId"] != "" {
			return indexed["retrieverId"]
		}
		return stringAttribute(attributes, "retrieverId")
	case "skill":
		return stringAttribute(attributes, "skillName")
	case "security":
		if indexed["promptId"] != "" {
			return indexed["promptId"]
		}
		return stringAttribute(attributes, "promptId")
	case "cost":
		if indexed["promptId"] != "" {
			return indexed["promptId"]
		}
		return stringAttribute(attributes, "model")
	default:
		if indexed["toolName"] != "" {
			return indexed["toolName"]
		}
		return ""
	}
}
