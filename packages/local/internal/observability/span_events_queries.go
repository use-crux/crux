package observability

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

func (s *Service) SpanEvents(
	ctx context.Context,
	runID string,
	spanID string,
	opts SpanEventListOptions,
) ([]SpanEventSummary, error) {
	ctx, cancel := s.queryContext(ctx)
	defer cancel()

	canonicalRunID, err := s.resolveRunID(ctx, runID)
	if err != nil {
		return nil, fmt.Errorf("resolve observability run %q: %w", runID, err)
	}
	limit := opts.Limit
	if limit <= 0 {
		limit = defaultSpanEventListLimit
	}

	query := strings.Builder{}
	query.WriteString(`
		SELECT event_id, run_id, ifnull(trace_id, ''), span_id, name, timestamp, attributes_json
		FROM span_events
		WHERE run_id = ? AND span_id = ?
	`)
	args := []any{canonicalRunID, spanID}
	if opts.Name != "" {
		query.WriteString(` AND name = ?`)
		args = append(args, opts.Name)
	}
	if opts.After != "" {
		query.WriteString(` AND timestamp > ?`)
		args = append(args, opts.After)
	}
	query.WriteString(` ORDER BY timestamp, event_id LIMIT ?`)
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, query.String(), args...)
	if err != nil {
		return nil, fmt.Errorf("query observability span events for run %q span %q: %w", runID, spanID, err)
	}
	defer rows.Close()

	events := make([]SpanEventSummary, 0)
	for rows.Next() {
		var event SpanEventSummary
		var attributes []byte
		if err := rows.Scan(&event.EventID, &event.RunID, &event.TraceID, &event.SpanID, &event.Name, &event.Timestamp, &attributes); err != nil {
			return nil, fmt.Errorf("scan observability span event for run %q span %q: %w", runID, spanID, err)
		}
		event.Attributes = json.RawMessage(attributes)
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate observability span events for run %q span %q: %w", runID, spanID, err)
	}
	return events, nil
}

func (s *Service) listEvents(ctx context.Context, runID string) ([]SpanEventSummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT event_id, run_id, ifnull(trace_id, ''), span_id, name, timestamp, attributes_json
		FROM span_events
		WHERE run_id = ? AND name != 'token.chunk'
		ORDER BY timestamp, event_id
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []SpanEventSummary
	for rows.Next() {
		var event SpanEventSummary
		var attributes []byte
		if err := rows.Scan(&event.EventID, &event.RunID, &event.TraceID, &event.SpanID, &event.Name, &event.Timestamp, &attributes); err != nil {
			return nil, err
		}
		event.Attributes = json.RawMessage(attributes)
		events = append(events, event)
	}
	return events, rows.Err()
}
