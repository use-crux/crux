package observability

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// RunSignals is the lightweight, list-safe observability rollup used by
// quality summaries and insights. It intentionally avoids building the full
// RunDetail presentation tree for every run in the local history.
type RunSignals struct {
	RunID                   string
	ToolCallCount           int
	ToolErrorCount          int
	RepeatedToolName        string
	RepeatedToolCount       int
	RetrievalIssueCount     int
	InspectSignalIssueCount int
	SuspensionSignalCount   int
	BlockedSignalCount      int
	DiagnosticCount         int
	DiagnosticMaxSeverity   string
	DiagnosticCodes         []string
}

// RunSignals returns one aggregate per run using a single pass over spans.
// Deep inspection remains available through RunDetail; this is the cheap path
// for run lists, overview cards, and insight derivation over thousands of runs.
func (s *Service) RunSignals(ctx context.Context) (map[string]RunSignals, error) {
	return s.runSignals(ctx, nil)
}

func (s *Service) RunSignalsForRuns(ctx context.Context, runIDs []string) (map[string]RunSignals, error) {
	uniqueRunIDs := uniqueNonEmptyStrings(runIDs)
	if len(uniqueRunIDs) == 0 {
		return map[string]RunSignals{}, nil
	}
	return s.runSignals(ctx, uniqueRunIDs)
}

func (s *Service) runSignals(ctx context.Context, runIDs []string) (map[string]RunSignals, error) {
	ctx, cancel := s.queryContext(ctx)
	defer cancel()

	signals, runTraceIDs, err := s.runSignalsFromRuns(ctx, runIDs)
	if err != nil {
		return nil, err
	}
	if len(signals) == 0 {
		return signals, nil
	}
	query := `
		SELECT span_id, run_id, ifnull(trace_id, ''), ifnull(parent_span_id, ''), ifnull(family, ''),
			ifnull(primitive, ''), ifnull(name, ''), ifnull(status, ''), ifnull(started_at, ''),
			ifnull(ended_at, ''), ifnull(duration_ms, 0), ifnull(tool_name, ''), attributes_json, error_json
		FROM spans
	`
	args := []any{}
	if runIDs != nil {
		query += `WHERE run_id IN (` + queryPlaceholders(len(runIDs)) + `)
	`
		args = queryArgs(runIDs)
	}
	query += `ORDER BY run_id, started_at, span_id`
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query observability run signals: %w", err)
	}
	defer rows.Close()

	toolCountsByRun := map[string]map[string]int{}
	spanIDsByRun := map[string]map[string]struct{}{}
	parentIDsByRun := map[string][]string{}
	crossTraceSeen := map[string]struct{}{}
	for rows.Next() {
		var span SpanSummary
		var toolName string
		var attributes, errorJSON []byte
		if err := rows.Scan(
			&span.SpanID,
			&span.RunID,
			&span.TraceID,
			&span.ParentSpanID,
			&span.Family,
			&span.Primitive,
			&span.Name,
			&span.Status,
			&span.StartedAt,
			&span.EndedAt,
			&span.DurationMs,
			&toolName,
			&attributes,
			&errorJSON,
		); err != nil {
			return nil, fmt.Errorf("scan observability run signal: %w", err)
		}
		span.ToolName = toolName
		span.Attributes = json.RawMessage(attributes)
		span.Error = json.RawMessage(errorJSON)
		signal := signals[span.RunID]
		signal.RunID = span.RunID
		attrs := jsonObject(json.RawMessage(attributes))
		statusNeedsAttention := attentionStatus(span.Status)

		if spanIDsByRun[span.RunID] == nil {
			spanIDsByRun[span.RunID] = map[string]struct{}{}
		}
		spanIDsByRun[span.RunID][span.SpanID] = struct{}{}
		if span.ParentSpanID != "" {
			parentIDsByRun[span.RunID] = append(parentIDsByRun[span.RunID], span.ParentSpanID)
		}
		if runTraceID := runTraceIDs[span.RunID]; runTraceID != "" && span.TraceID != "" && span.TraceID != runTraceID {
			if _, seen := crossTraceSeen[span.RunID]; !seen {
				addSignalDiagnostic(&signal, RunDetailDiagnostic{Code: "cross-trace-run", Severity: "warn"})
				crossTraceSeen[span.RunID] = struct{}{}
			}
		}
		for _, diagnostic := range spanDiagnostics(span) {
			addSignalDiagnostic(&signal, diagnostic)
		}

		if isToolSignal(span.Family, span.Primitive, toolName) {
			signal.ToolCallCount++
			name := firstNonEmptySignal(toolName, stringMapValue(attrs, "toolName"), span.Name, span.SpanID)
			if toolCountsByRun[span.RunID] == nil {
				toolCountsByRun[span.RunID] = map[string]int{}
			}
			toolCountsByRun[span.RunID][name]++
			if statusNeedsAttention || nonEmptyJSON(errorJSON) {
				signal.ToolErrorCount++
			}
		}
		if isRetrievalSignal(span.Family, span.Primitive) && (statusNeedsAttention || signalReturnedZero(attrs)) {
			signal.RetrievalIssueCount++
		}
		if isQualitySignal(span.Family, span.Primitive) && statusNeedsAttention {
			signal.InspectSignalIssueCount++
		}
		if normalizeSignalStatus(span.Status) == "blocked" {
			signal.BlockedSignalCount++
		}
		if normalizeSignalStatus(span.Status) == "suspended" || span.Primitive == "flow.suspension" {
			signal.SuspensionSignalCount++
		}
		if code := stringMapValue(attrs, "diagnosticCode"); code != "" {
			addSignalDiagnostic(&signal, RunDetailDiagnostic{Code: code, Severity: firstNonEmptySignal(stringMapValue(attrs, "diagnosticSeverity"), "warn")})
		}
		signals[span.RunID] = signal
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate observability run signals: %w", err)
	}

	for runID, parentIDs := range parentIDsByRun {
		spanIDs := spanIDsByRun[runID]
		signal := signals[runID]
		for _, parentID := range parentIDs {
			if _, ok := spanIDs[parentID]; ok {
				continue
			}
			addSignalDiagnostic(&signal, RunDetailDiagnostic{Code: "missing-parent-span", Severity: "warn"})
			break
		}
		signals[runID] = signal
	}

	for runID, counts := range toolCountsByRun {
		signal := signals[runID]
		for name, count := range counts {
			if count > signal.RepeatedToolCount {
				signal.RepeatedToolName = name
				signal.RepeatedToolCount = count
			}
		}
		signals[runID] = signal
	}
	return signals, nil
}

func (s *Service) runSignalsFromRuns(ctx context.Context, runIDs []string) (map[string]RunSignals, map[string]string, error) {
	query := `
		SELECT run_id, ifnull(trace_id, ''), ifnull(status, ''), ifnull(started_at, ''),
			ifnull(ended_at, ''), attributes_json
		FROM runs
	`
	args := []any{}
	if runIDs != nil {
		query += `WHERE run_id IN (` + queryPlaceholders(len(runIDs)) + `)`
		args = queryArgs(runIDs)
	}
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("query observability run signal roots: %w", err)
	}
	defer rows.Close()
	signals := map[string]RunSignals{}
	traceIDs := map[string]string{}
	for rows.Next() {
		var run RunSummary
		var attributes []byte
		if err := rows.Scan(&run.RunID, &run.TraceID, &run.Status, &run.StartedAt, &run.EndedAt, &attributes); err != nil {
			return nil, nil, fmt.Errorf("scan observability run signal root: %w", err)
		}
		run.Attributes = json.RawMessage(attributes)
		signal := RunSignals{RunID: run.RunID}
		for _, diagnostic := range runDiagnostics(run) {
			addSignalDiagnostic(&signal, diagnostic)
		}
		signals[run.RunID] = signal
		traceIDs[run.RunID] = run.TraceID
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate observability run signal roots: %w", err)
	}
	return signals, traceIDs, nil
}

func addSignalDiagnostic(signal *RunSignals, diagnostic RunDetailDiagnostic) {
	if signal == nil {
		return
	}
	signal.DiagnosticCount++
	if diagnostic.Code != "" {
		signal.DiagnosticCodes = appendUniqueString(signal.DiagnosticCodes, diagnostic.Code)
	}
	if diagnostic.Severity != "" && diagnosticSeverityRank(diagnostic.Severity) > diagnosticSeverityRank(signal.DiagnosticMaxSeverity) {
		signal.DiagnosticMaxSeverity = diagnostic.Severity
	}
}

func diagnosticSeverityRank(severity string) int {
	switch strings.ToLower(severity) {
	case "error":
		return 3
	case "warn", "warning":
		return 2
	case "info":
		return 1
	default:
		return 0
	}
}

func isToolSignal(family, primitive, toolName string) bool {
	return family == "tool" || primitive == "tool.call" || toolName != ""
}

func isRetrievalSignal(family, primitive string) bool {
	return family == "retrieval" || strings.HasPrefix(primitive, "retrieval.")
}

func isQualitySignal(family, primitive string) bool {
	switch family {
	case "guardrail", "constraint", "scoring", "citation":
		return true
	}
	return strings.HasPrefix(primitive, "guardrail.") ||
		strings.HasPrefix(primitive, "constraint.") ||
		strings.HasPrefix(primitive, "scoring.") ||
		strings.HasPrefix(primitive, "citation.")
}

func attentionStatus(status string) bool {
	switch normalizeSignalStatus(status) {
	case "error", "fail", "failed", "blocked", "incomplete", "stale":
		return true
	default:
		return false
	}
}

func normalizeSignalStatus(status string) string {
	status = strings.ToLower(strings.TrimSpace(status))
	switch status {
	case "success", "complete", "completed":
		return "ok"
	default:
		return status
	}
}

func signalReturnedZero(attrs map[string]any) bool {
	for _, key := range []string{"resultCount", "results", "hitCount", "hits", "count", "returned"} {
		value, ok := attrs[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case float64:
			return typed == 0
		case int:
			return typed == 0
		case []any:
			return len(typed) == 0
		}
	}
	return false
}

func jsonObject(raw json.RawMessage) map[string]any {
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]any{}
	}
	return out
}

func stringMapValue(values map[string]any, key string) string {
	if value, ok := values[key].(string); ok {
		return value
	}
	return ""
}

func nonEmptyJSON(raw []byte) bool {
	return len(raw) > 0 && string(raw) != "null" && string(raw) != "{}"
}

func appendUniqueString(values []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func firstNonEmptySignal(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
