package observability

import (
	"context"
	"encoding/json"
	"fmt"
)

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
		ORDER BY ifnull(started_at, '') DESC, span_id DESC
	`, family)
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

	for i := range activities {
		artifacts, err := s.listResourceArtifacts(ctx, activities[i].SpanID)
		if err != nil {
			return nil, fmt.Errorf("list observability resource artifacts %q: %w", family, err)
		}
		activities[i].Artifacts = artifacts
		edges, err := s.listResourceEdges(ctx, activities[i].SpanID)
		if err != nil {
			return nil, fmt.Errorf("list observability resource edges %q: %w", family, err)
		}
		activities[i].Edges = edges
	}
	return activities, nil
}

func (s *Service) listResourceArtifacts(ctx context.Context, spanID string) ([]ResourceArtifact, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT artifact_id, run_id, ifnull(trace_id, ''), ifnull(span_id, ''), kind, created_at,
			content_type, encoding, ifnull(size_bytes, 0), ifnull(hash, ''), preview_json, ifnull(uri, ''), attributes_json
		FROM artifacts
		WHERE span_id = ?
		ORDER BY created_at, artifact_id
	`, spanID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var artifacts []ResourceArtifact
	for rows.Next() {
		var artifact ResourceArtifact
		var preview, attributes []byte
		if err := rows.Scan(
			&artifact.ArtifactID,
			&artifact.RunID,
			&artifact.TraceID,
			&artifact.SpanID,
			&artifact.Kind,
			&artifact.CreatedAt,
			&artifact.ContentType,
			&artifact.Encoding,
			&artifact.SizeBytes,
			&artifact.Hash,
			&preview,
			&artifact.URI,
			&attributes,
		); err != nil {
			return nil, err
		}
		artifact.Preview = json.RawMessage(preview)
		artifact.Attributes = json.RawMessage(attributes)
		artifacts = append(artifacts, artifact)
	}
	return artifacts, rows.Err()
}

func (s *Service) listResourceEdges(ctx context.Context, spanID string) ([]EdgeSummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT edge_id, run_id, ifnull(trace_id, ''), edge_type, from_kind, from_id, to_kind, to_id, created_at, attributes_json
		FROM edges
		WHERE from_id = ? OR to_id = ?
		ORDER BY created_at, edge_id
	`, spanID, spanID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var edges []EdgeSummary
	for rows.Next() {
		var edge EdgeSummary
		var attributes []byte
		if err := rows.Scan(&edge.EdgeID, &edge.RunID, &edge.TraceID, &edge.EdgeType, &edge.From.Kind, &edge.From.ID, &edge.To.Kind, &edge.To.ID, &edge.CreatedAt, &attributes); err != nil {
			return nil, err
		}
		edge.Attributes = json.RawMessage(attributes)
		edges = append(edges, edge)
	}
	return edges, rows.Err()
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
