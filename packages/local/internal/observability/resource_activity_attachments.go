package observability

import (
	"context"
	"encoding/json"
)

func (s *Service) listResourceArtifactsBySpan(ctx context.Context, spanIDs []string) (map[string][]ResourceArtifact, error) {
	out := make(map[string][]ResourceArtifact, len(spanIDs))
	if len(spanIDs) == 0 {
		return out, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT artifact_id, run_id, ifnull(trace_id, ''), ifnull(span_id, ''), kind, created_at,
			content_type, encoding, ifnull(size_bytes, 0), ifnull(hash, ''), preview_json, ifnull(uri, ''), attributes_json
		FROM artifacts
		WHERE span_id IN (`+queryPlaceholders(len(spanIDs))+`)
		ORDER BY span_id, created_at, artifact_id
	`, queryArgs(spanIDs)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

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
		out[artifact.SpanID] = append(out[artifact.SpanID], artifact)
	}
	return out, rows.Err()
}

func (s *Service) listResourceEdgesBySpan(ctx context.Context, spanIDs []string) (map[string][]EdgeSummary, error) {
	out := make(map[string][]EdgeSummary, len(spanIDs))
	if len(spanIDs) == 0 {
		return out, nil
	}
	for _, spanID := range spanIDs {
		out[spanID] = nil
	}
	args := append(queryArgs(spanIDs), queryArgs(spanIDs)...)
	rows, err := s.db.QueryContext(ctx, `
		SELECT edge_id, run_id, ifnull(trace_id, ''), edge_type, from_kind, from_id, to_kind, to_id, created_at, attributes_json
		FROM edges
		WHERE from_id IN (`+queryPlaceholders(len(spanIDs))+`)
			OR to_id IN (`+queryPlaceholders(len(spanIDs))+`)
		ORDER BY created_at, edge_id
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var edge EdgeSummary
		var attributes []byte
		if err := rows.Scan(&edge.EdgeID, &edge.RunID, &edge.TraceID, &edge.EdgeType, &edge.From.Kind, &edge.From.ID, &edge.To.Kind, &edge.To.ID, &edge.CreatedAt, &attributes); err != nil {
			return nil, err
		}
		edge.Attributes = json.RawMessage(attributes)
		if _, ok := out[edge.From.ID]; ok {
			out[edge.From.ID] = append(out[edge.From.ID], edge)
		}
		if edge.To.ID != edge.From.ID {
			if _, ok := out[edge.To.ID]; ok {
				out[edge.To.ID] = append(out[edge.To.ID], edge)
			}
		}
	}
	return out, rows.Err()
}
