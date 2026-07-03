package observability

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const runSummaryRollupBatchSize = 100

func (s *Service) Run(ctx context.Context, runID string) (RunSummary, error) {
	queryCtx, cancel := s.queryContext(ctx)
	defer cancel()

	canonicalRunID, err := s.resolveRunID(queryCtx, runID)
	if err != nil {
		return RunSummary{}, fmt.Errorf("resolve observability run %q: %w", runID, err)
	}

	run, err := s.loadRunSummary(queryCtx, canonicalRunID, true)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return RunSummary{}, fmt.Errorf("run %q: %w", runID, ErrNotFound)
		}
		return RunSummary{}, fmt.Errorf("query observability run %q: %w", runID, err)
	}
	if err := s.enrichRunSummary(ctx, &run); err != nil {
		return RunSummary{}, err
	}
	return run, nil
}

func (s *Service) loadRunSummary(ctx context.Context, runID string, includeCounts bool) (RunSummary, error) {
	var run RunSummary
	countProjection := `
			0, 0, 0, 0, 0, 0, 0, 0`
	if includeCounts {
		countProjection = `
			r.record_count,
			r.span_count,
			r.event_count,
			r.artifact_count,
			r.edge_count,
			r.total_input_tokens,
			r.total_output_tokens,
			r.total_cost_usd`
	}
	row := s.db.QueryRowContext(ctx, `
		SELECT
			r.run_id, ifnull(r.trace_id, ''), ifnull(r.session_id, ''), ifnull(r.user_id, ''),
			ifnull(r.name, ''), ifnull(r.root_primitive, ''),
			ifnull(r.status, ''), ifnull(r.started_at, ''), ifnull(r.ended_at, ''),
			ifnull(r.duration_ms, 0),
			'', '', '',`+countProjection+`,
			r.attributes_json, r.metrics_json, r.error_json
		FROM runs r
		WHERE r.run_id = ?
	`, runID)
	var attributes, metrics, errorJSON []byte
	if err := row.Scan(
		&run.RunID,
		&run.TraceID,
		&run.SessionID,
		&run.UserID,
		&run.Name,
		&run.RootPrimitive,
		&run.Status,
		&run.StartedAt,
		&run.EndedAt,
		&run.DurationMs,
		&run.Model,
		&run.Provider,
		&run.PromptID,
		&run.RecordCount,
		&run.SpanCount,
		&run.EventCount,
		&run.ArtifactCount,
		&run.EdgeCount,
		&run.inputTokens,
		&run.outputTokens,
		&run.costUSD,
		&attributes,
		&metrics,
		&errorJSON,
	); err != nil {
		return RunSummary{}, err
	}
	run.Attributes = json.RawMessage(attributes)
	run.Metrics = json.RawMessage(metrics)
	run.Error = json.RawMessage(errorJSON)
	return run, nil
}

func (s *Service) Runs(ctx context.Context) ([]RunSummary, error) {
	return s.RunsWithOptions(ctx, RunListOptions{Limit: -1, IncludeExpensiveRollups: true})
}

func (s *Service) RunsWithOptions(ctx context.Context, opts RunListOptions) ([]RunSummary, error) {
	queryCtx, cancel := s.queryContext(ctx)
	defer cancel()

	limit, offset, limited := normalizeRunListOptions(opts)
	query := `
		SELECT
			r.run_id, ifnull(r.trace_id, ''), ifnull(r.session_id, ''), ifnull(r.user_id, ''),
			ifnull(r.name, ''), ifnull(r.root_primitive, ''),
			ifnull(r.status, ''), ifnull(r.started_at, ''), ifnull(r.ended_at, ''),
			ifnull(r.duration_ms, 0),
			'', '', '',
			r.record_count, r.span_count, r.event_count, r.artifact_count, r.edge_count,
			r.total_input_tokens, r.total_output_tokens, r.total_cost_usd,
				r.attributes_json, r.metrics_json, r.error_json
			FROM runs r`
	args := []any{}
	if opts.SessionID != "" {
		query += ` WHERE r.session_id = ?`
		args = append(args, opts.SessionID)
	}
	query += ` ORDER BY r.started_at DESC, r.run_id DESC`
	if limited {
		query += ` LIMIT ? OFFSET ?`
		args = append(args, limit, offset)
	}
	rows, err := s.db.QueryContext(queryCtx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query observability runs: %w", err)
	}

	var runs []RunSummary
	for rows.Next() {
		var run RunSummary
		var attributes, metrics, errorJSON []byte
		if err := rows.Scan(
			&run.RunID,
			&run.TraceID,
			&run.SessionID,
			&run.UserID,
			&run.Name,
			&run.RootPrimitive,
			&run.Status,
			&run.StartedAt,
			&run.EndedAt,
			&run.DurationMs,
			&run.Model,
			&run.Provider,
			&run.PromptID,
			&run.RecordCount,
			&run.SpanCount,
			&run.EventCount,
			&run.ArtifactCount,
			&run.EdgeCount,
			&run.inputTokens,
			&run.outputTokens,
			&run.costUSD,
			&attributes,
			&metrics,
			&errorJSON,
		); err != nil {
			return nil, fmt.Errorf("scan observability run: %w", err)
		}
		run.Attributes = json.RawMessage(attributes)
		run.Metrics = json.RawMessage(metrics)
		run.Error = json.RawMessage(errorJSON)
		runs = append(runs, run)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, fmt.Errorf("iterate observability runs: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close observability runs rows: %w", err)
	}
	if err := s.enrichRunSummaries(ctx, runs, opts.IncludeExpensiveRollups); err != nil {
		return nil, err
	}
	return runs, nil
}

func normalizeRunListOptions(opts RunListOptions) (int, int, bool) {
	if opts.Limit < 0 {
		return 0, nonNegativeInt(opts.Offset), false
	}
	limit := opts.Limit
	if limit == 0 {
		limit = DefaultRunListLimit
	}
	return limit, nonNegativeInt(opts.Offset), true
}

func nonNegativeInt(value int) int {
	if value < 0 {
		return 0
	}
	return value
}

func isRunListDeadlineError(err error) bool {
	return errors.Is(err, context.DeadlineExceeded)
}

func (s *Service) DeleteRuns(ctx context.Context, ids []string) ([]string, error) {
	ctx, cancel := s.mutationContext(ctx)
	defer cancel()

	requested := uniqueNonEmptyStrings(ids)
	if len(requested) == 0 {
		return []string{}, nil
	}

	resolved, err := s.ResolveRunIDs(ctx, requested)
	if err != nil {
		return nil, fmt.Errorf("resolve observability runs for deletion: %w", err)
	}
	deleted := uniqueMapValues(resolved)
	if len(deleted) == 0 {
		return []string{}, nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin observability delete transaction: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	if err := deleteRunRows(ctx, tx, deleted); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit observability run delete: %w", err)
	}
	committed = true

	s.lifecycleMu.Lock()
	for _, runID := range deleted {
		delete(s.lifecycleSignatures, runID)
	}
	s.lifecycleMu.Unlock()

	payload, _ := json.Marshal(map[string]any{"runIds": deleted})
	s.events.Publish(Event{
		Tag:      "ObservabilityEvent",
		Kind:     "observability.records",
		Action:   "deleted",
		Severity: "info",
		RefID:    deleted[0],
		Payload:  payload,
	})
	return deleted, nil
}

// ResolveRunIDs resolves run ids or trace ids to canonical run ids without
// loading full run summaries or presentation details.
func (s *Service) ResolveRunIDs(ctx context.Context, ids []string) (map[string]string, error) {
	requested := uniqueNonEmptyStrings(ids)
	if len(requested) == 0 {
		return map[string]string{}, nil
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(requested)), ",")
	args := make([]any, len(requested)*2)
	requestedSet := make(map[string]struct{}, len(requested))
	for i, id := range requested {
		requestedSet[id] = struct{}{}
		args[i] = id
		args[i+len(requested)] = id
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT run_id, ifnull(trace_id, '')
		FROM runs
		WHERE run_id IN (`+placeholders+`) OR trace_id IN (`+placeholders+`)
		ORDER BY ifnull(started_at, '') DESC, run_id DESC
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	resolved := map[string]string{}
	for rows.Next() {
		var runID, traceID string
		if err := rows.Scan(&runID, &traceID); err != nil {
			return nil, err
		}
		if _, ok := requestedSet[runID]; ok {
			resolved[runID] = runID
		}
		if _, ok := requestedSet[traceID]; ok {
			resolved[traceID] = runID
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return resolved, nil
}

func (s *Service) resolveRunID(ctx context.Context, id string) (string, error) {
	resolved, err := s.ResolveRunIDs(ctx, []string{id})
	if err != nil {
		return "", err
	}
	if runID, ok := resolved[id]; ok {
		return runID, nil
	}
	return id, nil
}

func uniqueMapValues(values map[string]string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func (s *Service) enrichRunSummary(ctx context.Context, run *RunSummary) error {
	if run == nil || run.RunID == "" {
		return nil
	}
	spanCtx, spanCancel := s.queryContext(ctx)
	spanMetrics, model, provider, promptID, err := s.runSpanSummaryRollup(spanCtx, run.RunID)
	spanCancel()
	if err != nil {
		return fmt.Errorf("roll up observability run %q span summary: %w", run.RunID, err)
	}
	if run.Model == "" {
		run.Model = model
	}
	if run.Provider == "" {
		run.Provider = provider
	}
	if run.PromptID == "" {
		run.PromptID = promptID
	}

	runMetrics := numericMetricsFromRaw(run.Metrics)
	eventCtx, eventCancel := s.queryContext(ctx)
	eventMetrics, err := s.runUsageEventRollup(eventCtx, run.RunID)
	eventCancel()
	if err != nil {
		return fmt.Errorf("roll up observability run %q usage events: %w", run.RunID, err)
	}
	mergeMissingOrZeroMetrics(runMetrics, spanMetrics)
	mergeMissingOrZeroMetrics(runMetrics, eventMetrics)
	normalizeUsageTotals(runMetrics)
	run.Metrics = metricsRawOrNil(runMetrics)
	return nil
}

func (s *Service) enrichRunSummaries(ctx context.Context, runs []RunSummary, includeExpensiveRollups bool) error {
	if len(runs) == 0 {
		return nil
	}
	byRunID := make(map[string]*RunSummary, len(runs))
	metricsByRunID := make(map[string]map[string]float64, len(runs))
	spanMetricsByRunID := make(map[string]map[string]float64, len(runs))
	eventMetricsByRunID := make(map[string]map[string]float64, len(runs))
	runIDs := make([]string, 0, len(runs))
	for i := range runs {
		byRunID[runs[i].RunID] = &runs[i]
		metricsByRunID[runs[i].RunID] = numericMetricsFromRaw(runs[i].Metrics)
		spanMetricsByRunID[runs[i].RunID] = map[string]float64{}
		eventMetricsByRunID[runs[i].RunID] = map[string]float64{}
		runIDs = append(runIDs, runs[i].RunID)
	}

	if err := s.enrichRunSummaryCounts(ctx, runIDs, byRunID); err != nil {
		if !includeExpensiveRollups && isRunListDeadlineError(err) {
			return nil
		}
		return err
	}
	if err := s.enrichRunSummaryIdentities(ctx, runIDs, byRunID); err != nil {
		if !includeExpensiveRollups && isRunListDeadlineError(err) {
			return nil
		}
		return err
	}
	if !includeExpensiveRollups {
		for i := range runs {
			applyStoredUsageRollups(&runs[i], metricsByRunID[runs[i].RunID])
			normalizeUsageTotals(metricsByRunID[runs[i].RunID])
			runs[i].Metrics = metricsRawOrNil(metricsByRunID[runs[i].RunID])
		}
		return nil
	}
	if err := s.enrichRunSummarySpanRollups(ctx, runIDs, byRunID, spanMetricsByRunID); err != nil {
		return err
	}
	if err := s.enrichRunSummaryUsageEventRollups(ctx, runIDs, eventMetricsByRunID); err != nil {
		return err
	}

	for i := range runs {
		metrics := metricsByRunID[runs[i].RunID]
		mergeMissingOrZeroMetrics(metrics, spanMetricsByRunID[runs[i].RunID])
		mergeMissingOrZeroMetrics(metrics, eventMetricsByRunID[runs[i].RunID])
		normalizeUsageTotals(metrics)
		runs[i].Metrics = metricsRawOrNil(metrics)
	}
	return nil
}

func (s *Service) enrichRunSummaryIdentities(ctx context.Context, runIDs []string, byRunID map[string]*RunSummary) error {
	for _, batch := range runIDBatches(runIDs, runSummaryRollupBatchSize) {
		batchCtx, cancel := s.queryContext(ctx)
		err := s.enrichRunSummaryIdentityBatch(batchCtx, batch, byRunID)
		cancel()
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) enrichRunSummaryIdentityBatch(ctx context.Context, runIDs []string, byRunID map[string]*RunSummary) error {
	rows, err := s.db.QueryContext(ctx, `
		SELECT run_id, ifnull(model, ''), ifnull(provider, ''), ifnull(prompt_id, '')
		FROM spans
		WHERE run_id IN (`+queryPlaceholders(len(runIDs))+`)
			AND (
				(model IS NOT NULL AND model != '')
				OR (provider IS NOT NULL AND provider != '')
				OR (prompt_id IS NOT NULL AND prompt_id != '')
			)
		ORDER BY run_id, started_at, span_id
	`, queryArgs(runIDs)...)
	if err != nil {
		return fmt.Errorf("query observability span identity rollups: %w", err)
	}
	for rows.Next() {
		var runID, spanModel, spanProvider, spanPromptID string
		if err := rows.Scan(&runID, &spanModel, &spanProvider, &spanPromptID); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan observability span identity rollup: %w", err)
		}
		run := byRunID[runID]
		if run == nil {
			continue
		}
		if run.Model == "" {
			run.Model = spanModel
		}
		if run.Provider == "" {
			run.Provider = spanProvider
		}
		if run.PromptID == "" {
			run.PromptID = spanPromptID
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate observability span identity rollups: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close observability span identity rollups rows: %w", err)
	}
	return nil
}

func (s *Service) enrichRunSummaryCounts(ctx context.Context, runIDs []string, byRunID map[string]*RunSummary) error {
	for _, batch := range runIDBatches(runIDs, runSummaryRollupBatchSize) {
		batchCtx, cancel := s.queryContext(ctx)
		rows, err := s.db.QueryContext(batchCtx, `
			SELECT run_id, record_count, span_count, event_count, artifact_count, edge_count,
				total_input_tokens, total_output_tokens, total_cost_usd
			FROM runs
			WHERE run_id IN (`+queryPlaceholders(len(batch))+`)
		`, queryArgs(batch)...)
		if err != nil {
			cancel()
			return fmt.Errorf("query observability count rollups: %w", err)
		}
		for rows.Next() {
			var runID string
			var recordCount, spanCount, eventCount, artifactCount, edgeCount int
			var inputTokens, outputTokens int
			var costUSD float64
			if err := rows.Scan(&runID, &recordCount, &spanCount, &eventCount, &artifactCount, &edgeCount, &inputTokens, &outputTokens, &costUSD); err != nil {
				_ = rows.Close()
				cancel()
				return fmt.Errorf("scan observability count rollup: %w", err)
			}
			if run := byRunID[runID]; run != nil {
				run.RecordCount = recordCount
				run.SpanCount = spanCount
				run.EventCount = eventCount
				run.ArtifactCount = artifactCount
				run.EdgeCount = edgeCount
				run.inputTokens = inputTokens
				run.outputTokens = outputTokens
				run.costUSD = costUSD
			}
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			cancel()
			return fmt.Errorf("iterate observability count rollups: %w", err)
		}
		if err := rows.Close(); err != nil {
			cancel()
			return fmt.Errorf("close observability count rollups rows: %w", err)
		}
		cancel()
	}
	return nil
}

func (s *Service) enrichRunSummarySpanRollups(
	ctx context.Context,
	runIDs []string,
	byRunID map[string]*RunSummary,
	spanMetricsByRunID map[string]map[string]float64,
) error {
	for _, batch := range runIDBatches(runIDs, runSummaryRollupBatchSize) {
		batchCtx, cancel := s.queryContext(ctx)
		err := s.enrichRunSummarySpanRollupBatch(batchCtx, batch, byRunID, spanMetricsByRunID)
		cancel()
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) enrichRunSummarySpanRollupBatch(
	ctx context.Context,
	runIDs []string,
	byRunID map[string]*RunSummary,
	spanMetricsByRunID map[string]map[string]float64,
) error {
	rows, err := s.db.QueryContext(ctx, `
			SELECT run_id, ifnull(model, ''), ifnull(provider, ''), ifnull(prompt_id, ''),
				attributes_json, metrics_json
			FROM spans
			WHERE run_id IN (`+queryPlaceholders(len(runIDs))+`)
			ORDER BY run_id, started_at, span_id
		`, queryArgs(runIDs)...)
	if err != nil {
		return fmt.Errorf("query observability span rollups: %w", err)
	}
	for rows.Next() {
		var runID, spanModel, spanProvider, spanPromptID string
		var attributes, spanMetrics []byte
		if err := rows.Scan(&runID, &spanModel, &spanProvider, &spanPromptID, &attributes, &spanMetrics); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan observability span rollup: %w", err)
		}
		run := byRunID[runID]
		if run == nil {
			continue
		}
		rawAttributes := json.RawMessage(attributes)
		if run.Model == "" {
			run.Model = firstNonEmpty(
				spanModel,
				stringAttribute(rawAttributes, "model"),
				stringAttribute(rawAttributes, "actualModelId"),
				stringAttribute(rawAttributes, "selectedModel"),
			)
		}
		if run.Provider == "" {
			run.Provider = firstNonEmpty(spanProvider, stringAttribute(rawAttributes, "provider"))
		}
		if run.PromptID == "" {
			run.PromptID = firstNonEmpty(spanPromptID, stringAttribute(rawAttributes, "promptId"))
		}
		addMetrics(spanMetricsByRunID[runID], metricsFromRaw(json.RawMessage(spanMetrics)))
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate observability span rollups: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close observability span rollups rows: %w", err)
	}
	return nil
}

func (s *Service) enrichRunSummaryUsageEventRollups(
	ctx context.Context,
	runIDs []string,
	eventMetricsByRunID map[string]map[string]float64,
) error {
	for _, batch := range runIDBatches(runIDs, runSummaryRollupBatchSize) {
		batchCtx, cancel := s.queryContext(ctx)
		err := s.enrichRunSummaryUsageEventRollupBatch(batchCtx, batch, eventMetricsByRunID)
		cancel()
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) enrichRunSummaryUsageEventRollupBatch(
	ctx context.Context,
	runIDs []string,
	eventMetricsByRunID map[string]map[string]float64,
) error {
	rows, err := s.db.QueryContext(ctx, `
			SELECT run_id, attributes_json
			FROM span_events
			WHERE name = 'usage.observed' AND run_id IN (`+queryPlaceholders(len(runIDs))+`)
		`, queryArgs(runIDs)...)
	if err != nil {
		return fmt.Errorf("query observability usage event rollups: %w", err)
	}
	for rows.Next() {
		var runID string
		var attributes []byte
		if err := rows.Scan(&runID, &attributes); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan observability usage event rollup: %w", err)
		}
		if metrics := eventMetricsByRunID[runID]; metrics != nil {
			addMetrics(metrics, metricsFromRaw(json.RawMessage(attributes)))
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate observability usage event rollups: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close observability usage event rollups rows: %w", err)
	}
	return nil
}

func runIDBatches(runIDs []string, size int) [][]string {
	if len(runIDs) == 0 {
		return nil
	}
	if size <= 0 || size >= len(runIDs) {
		return [][]string{runIDs}
	}
	batches := make([][]string, 0, (len(runIDs)+size-1)/size)
	for start := 0; start < len(runIDs); start += size {
		end := start + size
		if end > len(runIDs) {
			end = len(runIDs)
		}
		batches = append(batches, runIDs[start:end])
	}
	return batches
}

func queryPlaceholders(count int) string {
	return strings.TrimRight(strings.Repeat("?,", count), ",")
}

func queryArgs(values []string) []any {
	args := make([]any, len(values))
	for i, value := range values {
		args[i] = value
	}
	return args
}

func (s *Service) runSpanSummaryRollup(ctx context.Context, runID string) (map[string]float64, string, string, string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			ifnull(model, ''), ifnull(provider, ''), ifnull(prompt_id, ''),
			attributes_json, metrics_json
		FROM spans
		WHERE run_id = ?
		ORDER BY ifnull(started_at, ''), span_id
	`, runID)
	if err != nil {
		return nil, "", "", "", err
	}
	defer rows.Close()

	metrics := map[string]float64{}
	var model, provider, promptID string
	for rows.Next() {
		var spanModel, spanProvider, spanPromptID string
		var attributes, spanMetrics []byte
		if err := rows.Scan(&spanModel, &spanProvider, &spanPromptID, &attributes, &spanMetrics); err != nil {
			return nil, "", "", "", err
		}
		rawAttributes := json.RawMessage(attributes)
		if model == "" {
			model = firstNonEmpty(
				spanModel,
				stringAttribute(rawAttributes, "model"),
				stringAttribute(rawAttributes, "actualModelId"),
				stringAttribute(rawAttributes, "selectedModel"),
			)
		}
		if provider == "" {
			provider = firstNonEmpty(spanProvider, stringAttribute(rawAttributes, "provider"))
		}
		if promptID == "" {
			promptID = firstNonEmpty(spanPromptID, stringAttribute(rawAttributes, "promptId"))
		}
		addMetrics(metrics, metricsFromRaw(json.RawMessage(spanMetrics)))
	}
	if err := rows.Err(); err != nil {
		return nil, "", "", "", err
	}
	normalizeUsageTotals(metrics)
	return metrics, model, provider, promptID, nil
}

func (s *Service) runUsageEventRollup(ctx context.Context, runID string) (map[string]float64, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT attributes_json
		FROM span_events
		WHERE run_id = ? AND name = 'usage.observed'
		ORDER BY timestamp, event_id
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	metrics := map[string]float64{}
	for rows.Next() {
		var attributes []byte
		if err := rows.Scan(&attributes); err != nil {
			return nil, err
		}
		addMetrics(metrics, metricsFromRaw(json.RawMessage(attributes)))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	normalizeUsageTotals(metrics)
	return metrics, nil
}

func (s *Service) Graph(ctx context.Context, runID string) (Graph, error) {
	return s.graph(ctx, runID, true)
}

func (s *Service) graph(ctx context.Context, runID string, includeRecords bool) (Graph, error) {
	ctx, cancel := s.queryContext(ctx)
	defer cancel()

	canonicalRunID, err := s.resolveRunID(ctx, runID)
	if err != nil {
		return Graph{}, fmt.Errorf("resolve observability run %q: %w", runID, err)
	}

	run, err := s.loadRunSummary(ctx, canonicalRunID, false)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Graph{}, fmt.Errorf("run %q: %w", runID, ErrNotFound)
		}
		return Graph{}, fmt.Errorf("query observability run %q: %w", runID, err)
	}

	spans, err := s.listSpans(ctx, canonicalRunID)
	if err != nil {
		return Graph{}, fmt.Errorf("list spans for run %q: %w", runID, err)
	}
	events, err := s.listEvents(ctx, canonicalRunID)
	if err != nil {
		return Graph{}, fmt.Errorf("list events for run %q: %w", runID, err)
	}
	artifacts, err := s.listArtifacts(ctx, canonicalRunID)
	if err != nil {
		return Graph{}, fmt.Errorf("list artifacts for run %q: %w", runID, err)
	}
	edges, err := s.listEdges(ctx, canonicalRunID)
	if err != nil {
		return Graph{}, fmt.Errorf("list edges for run %q: %w", runID, err)
	}
	applyRunSummaryGraphRollups(&run, spans, events, artifacts, edges)

	var records []StoredRecord
	if includeRecords {
		records, err = s.listRecords(ctx, canonicalRunID)
		if err != nil {
			return Graph{}, fmt.Errorf("list raw records for run %q: %w", runID, err)
		}
		run.RecordCount = len(records)
	}

	return Graph{
		Run:       run,
		Spans:     spans,
		Events:    events,
		Artifacts: artifacts,
		Edges:     edges,
		Records:   records,
	}, nil
}

func (s *Service) RunDetail(ctx context.Context, runID string) (RunDetail, error) {
	ctx, cancel := s.queryContext(ctx)
	defer cancel()

	graph, err := s.graph(ctx, runID, false)
	if err != nil {
		return RunDetail{}, err
	}
	return ProjectRunDetail(graph, DefaultProjectionOptions()), nil
}

func applyRunSummaryGraphRollups(run *RunSummary, spans []SpanSummary, events []SpanEventSummary, artifacts []ArtifactSummary, edges []EdgeSummary) {
	if run == nil {
		return
	}
	run.SpanCount = len(spans)
	run.EventCount = len(events)
	run.ArtifactCount = len(artifacts)
	run.EdgeCount = len(edges)
	runMetrics := numericMetricsFromRaw(run.Metrics)
	for _, span := range spans {
		if run.Model == "" {
			run.Model = firstNonEmpty(
				span.Model,
				stringAttribute(span.Attributes, "model"),
				stringAttribute(span.Attributes, "actualModelId"),
				stringAttribute(span.Attributes, "selectedModel"),
			)
		}
		if run.Provider == "" {
			run.Provider = firstNonEmpty(span.Provider, stringAttribute(span.Attributes, "provider"))
		}
		if run.PromptID == "" {
			run.PromptID = firstNonEmpty(span.PromptID, stringAttribute(span.Attributes, "promptId"))
		}
		addMetrics(runMetrics, metricsFromRaw(span.Metrics))
	}
	for _, event := range events {
		if event.Name == "usage.observed" {
			addMetrics(runMetrics, metricsFromRaw(event.Attributes))
		}
	}
	normalizeUsageTotals(runMetrics)
	run.Metrics = metricsRawOrNil(runMetrics)
}

func (s *Service) listSpans(ctx context.Context, runID string) ([]SpanSummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT span_id, run_id, ifnull(trace_id, ''), ifnull(parent_span_id, ''), ifnull(family, ''),
			ifnull(primitive, ''), ifnull(name, ''), ifnull(status, ''), ifnull(started_at, ''),
			ifnull(ended_at, ''), ifnull(duration_ms, 0), ifnull(model, ''), ifnull(provider, ''),
			ifnull(prompt_id, ''), ifnull(context_id, ''), ifnull(agent_id, ''), ifnull(tool_name, ''),
			ifnull(flow_id, ''), ifnull(step_id, ''), ifnull(memory_id, ''), ifnull(retriever_id, ''),
			attributes_json, metrics_json, error_json
		FROM spans
		WHERE run_id = ?
		ORDER BY ifnull(started_at, ''), span_id
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var spans []SpanSummary
	for rows.Next() {
		var span SpanSummary
		var attributes, metrics, errorJSON []byte
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
			&span.Model,
			&span.Provider,
			&span.PromptID,
			&span.ContextID,
			&span.AgentID,
			&span.ToolName,
			&span.FlowID,
			&span.StepID,
			&span.MemoryID,
			&span.RetrieverID,
			&attributes,
			&metrics,
			&errorJSON,
		); err != nil {
			return nil, err
		}
		span.Attributes = json.RawMessage(attributes)
		span.Metrics = json.RawMessage(metrics)
		span.Error = json.RawMessage(errorJSON)
		hydrateSpanModelFields(&span)
		spans = append(spans, span)
	}
	return spans, rows.Err()
}

func hydrateSpanModelFields(span *SpanSummary) {
	if span.Model == "" {
		span.Model = firstNonEmpty(
			stringAttribute(span.Attributes, "model"),
			stringAttribute(span.Attributes, "modelId"),
			stringAttribute(span.Attributes, "actualModelId"),
			stringAttribute(span.Attributes, "selectedModel"),
			stringAttribute(span.Attributes, "selectedModelId"),
		)
	}
	if span.Provider == "" {
		span.Provider = firstNonEmpty(
			stringAttribute(span.Attributes, "provider"),
			stringAttribute(span.Attributes, "providerId"),
			providerFromModelID(span.Model),
		)
	}
}

func providerFromModelID(modelID string) string {
	if idx := strings.Index(modelID, "/"); idx > 0 {
		return modelID[:idx]
	}
	return ""
}

func (s *Service) listEvents(ctx context.Context, runID string) ([]SpanEventSummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT event_id, run_id, ifnull(trace_id, ''), span_id, name, timestamp, attributes_json
		FROM span_events
		WHERE run_id = ?
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

func (s *Service) listArtifacts(ctx context.Context, runID string) ([]ArtifactSummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT artifact_id, run_id, ifnull(trace_id, ''), ifnull(span_id, ''), kind, created_at,
			content_type, encoding, ifnull(size_bytes, 0), ifnull(hash, ''), ifnull(uri, ''),
			preview_json, attributes_json
		FROM artifacts
		WHERE run_id = ?
		ORDER BY created_at, artifact_id
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var artifacts []ArtifactSummary
	for rows.Next() {
		var artifact ArtifactSummary
		var preview, attributes []byte
		if err := rows.Scan(&artifact.ArtifactID, &artifact.RunID, &artifact.TraceID, &artifact.SpanID, &artifact.Kind, &artifact.CreatedAt, &artifact.ContentType, &artifact.Encoding, &artifact.SizeBytes, &artifact.Hash, &artifact.URI, &preview, &attributes); err != nil {
			return nil, err
		}
		artifact.Preview = json.RawMessage(preview)
		artifact.Attributes = json.RawMessage(attributes)
		artifacts = append(artifacts, artifact)
	}
	return artifacts, rows.Err()
}

func (s *Service) listEdges(ctx context.Context, runID string) ([]EdgeSummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT edge_id, run_id, ifnull(trace_id, ''), edge_type, from_kind, from_id, to_kind, to_id, created_at, attributes_json
		FROM edges
		WHERE run_id = ?
		ORDER BY created_at, edge_id
	`, runID)
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

func (s *Service) listRecords(ctx context.Context, runID string) ([]StoredRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT record_id, run_id, ifnull(trace_id, ''), seq, type, payload_json, received_at
		FROM records
		WHERE run_id = ?
		ORDER BY CASE WHEN seq > 0 THEN 0 ELSE 1 END, seq, received_at, record_id
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []StoredRecord
	for rows.Next() {
		var record StoredRecord
		if err := rows.Scan(&record.RecordID, &record.RunID, &record.TraceID, &record.Seq, &record.Type, &record.PayloadJSON, &record.ReceivedAt); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func uniqueNonEmptyStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}
