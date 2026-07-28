package observability

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const runSummaryRollupBatchSize = 100

const effectiveRunStatusSQL = `CASE
	WHEN r.lifecycle_status = 'reconciled-incomplete' THEN 'incomplete'
	WHEN r.lifecycle_status LIKE 'reconciled-terminal:%' THEN substr(r.lifecycle_status, length('reconciled-terminal:') + 1)
	ELSE ifnull(r.status, '')
END`

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
	runs := []RunSummary{run}
	if err := s.enrichRunDeliveryHealth(ctx, runs); err != nil {
		return RunSummary{}, err
	}
	return runs[0], nil
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
			r.run_id, r.operation_id, ifnull(r.trace_id, ''), ifnull(r.session_id, ''), ifnull(r.user_id, ''),
			ifnull(r.project_id, ''), ifnull(r.manifest_id, ''), ifnull(r.deployment_id, ''),
			ifnull(r.name, ''), ifnull(r.root_primitive, ''),
			`+effectiveRunStatusSQL+`, ifnull(r.started_at, ''), ifnull(r.ended_at, ''),
			ifnull(r.duration_ms, 0),
			'', '', '',`+countProjection+`,
			ifnull(r.last_activity_at, ''), r.revision,
			r.attributes_json, r.metrics_json, r.error_json
		FROM runs r
		WHERE r.run_id = ?
	`, runID)
	var attributes, metrics, errorJSON []byte
	var projectID, manifestID, deploymentID string
	if err := row.Scan(
		&run.RunID,
		&run.OperationID,
		&run.TraceID,
		&run.SessionID,
		&run.UserID,
		&projectID,
		&manifestID,
		&deploymentID,
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
		&run.LastActivityAt,
		&run.Revision,
		&attributes,
		&metrics,
		&errorJSON,
	); err != nil {
		return RunSummary{}, err
	}
	run.Attributes = json.RawMessage(attributes)
	run.Metrics = json.RawMessage(metrics)
	run.Error = json.RawMessage(errorJSON)
	run.Deployment = deploymentIdentityFromColumns(projectID, manifestID, deploymentID)
	run.RootRunID = run.OperationID
	run.RootPresent = run.RunID == run.OperationID && run.Name != ""
	return run, nil
}

func (s *Service) Runs(ctx context.Context) ([]RunSummary, error) {
	return s.RunsWithOptions(ctx, RunListOptions{Limit: -1, IncludeExpensiveRollups: true})
}

func (s *Service) RunsWithOptions(ctx context.Context, opts RunListOptions) ([]RunSummary, error) {
	runs, _, err := s.runsWithOptions(ctx, opts)
	return runs, err
}

// runsWithOptions is the shared core behind RunsWithOptions and RunsPage. All
// status/time-range/session filtering and cursor pagination happen in SQL,
// before any row is truncated by LIMIT, so a filtered query is never silently
// restricted to whatever fit in the newest-first window. It returns the
// fetchedLimit actually applied (0 when unbounded) so callers can detect a
// full page and compute a next cursor.
func (s *Service) runsWithOptions(ctx context.Context, opts RunListOptions) ([]RunSummary, int, error) {
	queryCtx, cancel := s.queryContext(ctx)
	defer cancel()

	limit, offset, limited := normalizeRunListOptions(opts)
	where, args, err := runListWhereClause(opts)
	if err != nil {
		return nil, 0, err
	}
	query := `
		WITH family AS (
			SELECT m.operation_id,
				sum(m.record_count) AS record_count,
				sum(m.span_count) AS span_count,
				sum(m.event_count) AS event_count,
				sum(m.artifact_count) AS artifact_count,
				sum(m.edge_count) AS edge_count,
				sum(m.total_input_tokens) AS total_input_tokens,
				sum(m.total_output_tokens) AS total_output_tokens,
				sum(m.total_cost_usd) AS total_cost_usd,
				max(ifnull(m.last_activity_at, '')) AS last_activity_at,
				sum(CASE WHEN m.run_id != m.operation_id THEN 1 ELSE 0 END) AS child_run_count,
				sum(CASE WHEN m.run_id != m.operation_id AND (` + strings.ReplaceAll(effectiveRunStatusSQL, "r.", "m.") + `) = 'running' THEN 1 ELSE 0 END) AS active_child_count,
				sum(CASE WHEN m.run_id != m.operation_id AND (` + strings.ReplaceAll(effectiveRunStatusSQL, "r.", "m.") + `) = 'suspended' THEN 1 ELSE 0 END) AS suspended_child_count,
				sum(CASE WHEN m.run_id != m.operation_id AND (` + strings.ReplaceAll(effectiveRunStatusSQL, "r.", "m.") + `) IN ('error', 'blocked', 'cancelled', 'conflicted', 'incomplete') THEN 1 ELSE 0 END) AS failed_child_count
			FROM runs m GROUP BY m.operation_id
		)
		SELECT
			o.operation_id, o.operation_id,
			ifnull(r.trace_id, ''), ifnull(r.session_id, ''), ifnull(r.user_id, ''),
			ifnull(r.project_id, ''), ifnull(r.manifest_id, ''), ifnull(r.deployment_id, ''),
			CASE WHEN o.root_present != 0 THEN ifnull(r.name, '') ELSE 'Incomplete operation' END,
			CASE WHEN o.root_present != 0 THEN ifnull(r.root_primitive, '') ELSE '' END,
			CASE WHEN o.root_present != 0 THEN ` + effectiveRunStatusSQL + ` ELSE 'incomplete' END,
			CASE WHEN o.root_present != 0 THEN ifnull(r.started_at, '') ELSE '' END,
			CASE WHEN o.root_present != 0 THEN ifnull(r.ended_at, '') ELSE '' END,
			CASE WHEN o.root_present != 0 THEN ifnull(r.duration_ms, 0) ELSE 0 END,
			ifnull((SELECT sp.model FROM spans sp JOIN runs sm ON sm.run_id = sp.run_id WHERE sm.operation_id = o.operation_id AND sp.model IS NOT NULL AND sp.model != '' ORDER BY sp.started_at, sp.span_id LIMIT 1), ''),
			ifnull((SELECT sp.provider FROM spans sp JOIN runs sm ON sm.run_id = sp.run_id WHERE sm.operation_id = o.operation_id AND sp.provider IS NOT NULL AND sp.provider != '' ORDER BY sp.started_at, sp.span_id LIMIT 1), ''),
			ifnull((SELECT sp.prompt_id FROM spans sp JOIN runs sm ON sm.run_id = sp.run_id WHERE sm.operation_id = o.operation_id AND sp.prompt_id IS NOT NULL AND sp.prompt_id != '' ORDER BY sp.started_at, sp.span_id LIMIT 1), ''),
			ifnull(f.record_count, 0), ifnull(f.span_count, 0), ifnull(f.event_count, 0), ifnull(f.artifact_count, 0), ifnull(f.edge_count, 0),
			ifnull(f.total_input_tokens, 0), ifnull(f.total_output_tokens, 0), ifnull(f.total_cost_usd, 0),
			ifnull(f.last_activity_at, ''), o.revision,
			CASE WHEN o.root_present != 0 THEN r.attributes_json ELSE NULL END,
			CASE WHEN o.root_present != 0 THEN r.metrics_json ELSE NULL END,
			CASE WHEN o.root_present != 0 THEN r.error_json ELSE NULL END,
			o.root_present, o.first_seen_at,
			ifnull(f.child_run_count, 0), ifnull(f.active_child_count, 0), ifnull(f.suspended_child_count, 0), ifnull(f.failed_child_count, 0)
		FROM operations o
		LEFT JOIN runs r ON r.run_id = o.operation_id AND r.operation_id = o.operation_id
		LEFT JOIN family f ON f.operation_id = o.operation_id`
	if where != "" {
		query += ` WHERE ` + where
	}
	query += ` ORDER BY o.first_seen_at DESC, o.operation_id DESC`
	appliedLimit := 0
	if limited {
		appliedLimit = limit
		query += ` LIMIT ? OFFSET ?`
		args = append(args, limit, offset)
	}
	rows, err := s.db.QueryContext(queryCtx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("query observability runs: %w", err)
	}

	var runs []RunSummary
	for rows.Next() {
		var run RunSummary
		var attributes, metrics, errorJSON []byte
		var projectID, manifestID, deploymentID string
		if err := rows.Scan(
			&run.RunID,
			&run.OperationID,
			&run.TraceID,
			&run.SessionID,
			&run.UserID,
			&projectID,
			&manifestID,
			&deploymentID,
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
			&run.LastActivityAt,
			&run.Revision,
			&attributes,
			&metrics,
			&errorJSON,
			&run.RootPresent,
			&run.FirstSeenAt,
			&run.ChildRunCount,
			&run.ActiveChildCount,
			&run.SuspendedChildCount,
			&run.FailedChildCount,
		); err != nil {
			return nil, 0, fmt.Errorf("scan observability run: %w", err)
		}
		run.Attributes = json.RawMessage(attributes)
		run.Metrics = json.RawMessage(metrics)
		run.Error = json.RawMessage(errorJSON)
		run.Deployment = deploymentIdentityFromColumns(projectID, manifestID, deploymentID)
		run.RootRunID = run.OperationID
		run.TopologyHealth = "healthy"
		if !run.RootPresent {
			run.TopologyHealth = "incomplete"
		}
		totals := map[string]float64{}
		if run.inputTokens != 0 {
			totals["inputTokens"] = float64(run.inputTokens)
		}
		if run.outputTokens != 0 {
			totals["outputTokens"] = float64(run.outputTokens)
		}
		if run.costUSD != 0 {
			totals["costUsd"] = run.costUSD
		}
		normalizeUsageTotals(totals)
		run.Metrics = metricsRawOrNil(totals)
		runs = append(runs, run)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, 0, fmt.Errorf("iterate observability runs: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, 0, fmt.Errorf("close observability runs rows: %w", err)
	}
	if err := s.enrichOperationSummaries(ctx, runs); err != nil {
		return nil, 0, err
	}
	return runs, appliedLimit, nil
}

func deploymentIdentityFromColumns(
	projectID string,
	manifestID string,
	deploymentID string,
) *DeploymentIdentity {
	if projectID == "" {
		return nil
	}
	return &DeploymentIdentity{
		ProjectID:    projectID,
		ManifestID:   manifestID,
		DeploymentID: deploymentID,
	}
}

// runListWhereClause builds the SQL predicate for status/session/time-range
// filters and, when a Cursor is present, the keyset predicate that continues
// strictly after the row the cursor names. All of this runs before LIMIT so
// filtered/paginated counts and visible rows agree with each other.
func runListWhereClause(opts RunListOptions) (string, []any, error) {
	var clauses []string
	var args []any
	if opts.SessionID != "" {
		clauses = append(clauses, `r.session_id = ?`)
		args = append(args, opts.SessionID)
	}
	if len(opts.Status) > 0 {
		clauses = append(clauses, `(CASE WHEN o.root_present != 0 THEN `+effectiveRunStatusSQL+` ELSE 'incomplete' END) IN (`+queryPlaceholders(len(opts.Status))+`)`)
		args = append(args, queryArgs(opts.Status)...)
	}
	if opts.Since != "" {
		clauses = append(clauses, `o.first_seen_at >= ?`)
		args = append(args, opts.Since)
	}
	if opts.Until != "" {
		clauses = append(clauses, `o.first_seen_at <= ?`)
		args = append(args, opts.Until)
	}
	if opts.DefinitionID != "" {
		clauses = append(clauses, `o.operation_id IN (SELECT m.operation_id FROM run_definition_activity a JOIN runs m ON m.run_id = a.run_id WHERE a.definition_id = ?)`)
		args = append(args, opts.DefinitionID)
	}
	if opts.Cursor != "" {
		startedAt, runID, err := decodeRunListCursor(opts.Cursor)
		if err != nil {
			return "", nil, err
		}
		clauses = append(clauses, `(o.first_seen_at < ? OR (o.first_seen_at = ? AND o.operation_id < ?))`)
		args = append(args, startedAt, startedAt, runID)
	}
	if len(clauses) == 0 {
		return "", nil, nil
	}
	return strings.Join(clauses, " AND "), args, nil
}

func encodeRunListCursor(startedAt, runID string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(startedAt + "\x00" + runID))
}

func decodeRunListCursor(cursor string) (string, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return "", "", fmt.Errorf("invalid observability runs cursor: %w", err)
	}
	parts := strings.SplitN(string(raw), "\x00", 2)
	if len(parts) != 2 {
		return "", "", fmt.Errorf("invalid observability runs cursor: malformed payload")
	}
	return parts[0], parts[1], nil
}

// RunsPage is the one joined, revisioned Runs read model: it runs
// filters/pagination in SQL before enrichment, batches Inspect-correlation-
// adjacent delivery-health/segment/rollup joins so they never scale per row,
// and reports the server's current revision alongside a stable cursor for
// the next page.
func (s *Service) RunsPage(ctx context.Context, opts RunListOptions) (RunsResponse, error) {
	runs, appliedLimit, err := s.runsWithOptions(ctx, opts)
	if err != nil {
		return RunsResponse{}, err
	}
	if runs == nil {
		runs = []RunSummary{}
	}
	revision, err := s.CurrentRevision(ctx)
	if err != nil {
		return RunsResponse{}, err
	}
	response := RunsResponse{Revision: revision, Rows: runs}
	if appliedLimit > 0 && len(runs) == appliedLimit {
		last := runs[len(runs)-1]
		response.NextCursor = encodeRunListCursor(last.FirstSeenAt, last.OperationID)
	}
	return response, nil
}

// enrichRunDeliveryHealth batches one ingest_health query across every run in
// the page, instead of one query per row, reports "degraded" for runs with a
// persisted ingest-health rejection, "healthy" for runs that reached a
// terminal state with no observed gaps/conflicts and no rejection, and
// "unknown" for everything else (e.g. still running, or reconciled with
// segment gaps/ordering uncertainty short of an outright conflict) rather
// than defaulting to "healthy".
func (s *Service) enrichRunDeliveryHealth(ctx context.Context, runs []RunSummary) error {
	if len(runs) == 0 {
		return nil
	}
	byRunID := make(map[string]*RunSummary, len(runs))
	runIDs := make([]string, 0, len(runs))
	for i := range runs {
		runs[i].DeliveryHealth = &RunDeliveryHealth{Status: "unknown"}
		byRunID[runs[i].RunID] = &runs[i]
		runIDs = append(runIDs, runs[i].RunID)
	}
	for _, batch := range runIDBatches(runIDs, runSummaryRollupBatchSize) {
		if err := s.enrichRunDeliveryHealthBatch(ctx, batch, byRunID); err != nil {
			return err
		}
	}
	for i := range runs {
		if runs[i].DeliveryHealth.Status == "unknown" && isFullyDeliveredRun(&runs[i]) {
			runs[i].DeliveryHealth = &RunDeliveryHealth{Status: "healthy"}
		}
	}
	return nil
}

// isFullyDeliveredRun reports whether a run reached a terminal, non-conflict
// lifecycle status with a fully causal segment chain (no gaps or broken
// chain) — the only truthful, positive basis for
// reporting "healthy" delivery. A run that is still running, was reconciled
// as incomplete/conflicted, or whose segment ordering is only "partial"
// stays "unknown": the server has no persisted signal proving delivery
// completed cleanly, and "unknown" must never be conflated with "healthy".
func isFullyDeliveredRun(run *RunSummary) bool {
	return run.EndedAt != "" &&
		run.Status != "running" &&
		run.Status != "incomplete" &&
		run.Status != "conflicted" &&
		run.OrderingConfidence == "causal" &&
		run.GapCount == 0
}

func (s *Service) enrichRunDeliveryHealthBatch(ctx context.Context, runIDs []string, byRunID map[string]*RunSummary) error {
	batchCtx, cancel := s.queryContext(ctx)
	defer cancel()
	rows, err := s.db.QueryContext(batchCtx, `
		SELECT run_id, sum(occurrence_count), max(last_seen_at)
		FROM ingest_health
		WHERE run_id IN (`+queryPlaceholders(len(runIDs))+`)
		GROUP BY run_id
	`, queryArgs(runIDs)...)
	if err != nil {
		return fmt.Errorf("query observability delivery health rollups: %w", err)
	}
	for rows.Next() {
		var runID, lastSeenAt string
		var rejected int
		if err := rows.Scan(&runID, &rejected, &lastSeenAt); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan observability delivery health rollup: %w", err)
		}
		if run := byRunID[runID]; run != nil {
			run.DeliveryHealth = &RunDeliveryHealth{Status: "degraded", Rejected: rejected, LastKnownAt: lastSeenAt}
		}
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate observability delivery health rollups: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close observability delivery health rollups rows: %w", err)
	}
	return nil
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

	resolved, err := s.resolveOperationIDs(ctx, requested)
	if err != nil {
		return nil, fmt.Errorf("resolve observability runs for deletion: %w", err)
	}
	deletedOperations := uniqueMapValues(resolved)
	if len(deletedOperations) == 0 {
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
	// Bump a fresh tombstone revision for each deleted run BEFORE removing
	// its rows: this is the only durable signal a reconnecting client (or
	// one that missed the WS push) has that the run is gone, not merely
	// unchanged. See the comment on deleteRunRows/observability_run_revision_log.
	revisions, err := bumpRunRevisions(ctx, tx, deletedOperations, s.revisionLogRetentionOrDefault())
	if err != nil {
		return nil, fmt.Errorf("advance observability revision for deleted runs: %w", err)
	}
	memberRunIDs, err := operationMemberRunIDs(ctx, tx, deletedOperations)
	if err != nil {
		return nil, err
	}
	for _, operationID := range deletedOperations {
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO operation_tombstones (operation_id) VALUES (?)`, operationID); err != nil {
			return nil, fmt.Errorf("write operation deletion tombstone: %w", err)
		}
	}
	if len(memberRunIDs) > 0 {
		if err := deleteRunRows(ctx, tx, memberRunIDs); err != nil {
			return nil, err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM operations WHERE operation_id IN (`+queryPlaceholders(len(deletedOperations))+`)`, queryArgs(deletedOperations)...); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit observability run delete: %w", err)
	}
	committed = true

	payload, _ := json.Marshal(map[string]any{"operationIds": deletedOperations, "revision": maxRevision(revisions)})
	s.events.Publish(Event{
		Tag:      "ObservabilityEvent",
		Kind:     "observability.records",
		Action:   "deleted",
		Severity: "info",
		RefID:    deletedOperations[0],
		Payload:  payload,
	})
	return deletedOperations, nil
}

func (s *Service) resolveOperationIDs(ctx context.Context, ids []string) (map[string]string, error) {
	requested := uniqueNonEmptyStrings(ids)
	if len(requested) == 0 {
		return map[string]string{}, nil
	}
	placeholders := queryPlaceholders(len(requested))
	args := append(queryArgs(requested), queryArgs(requested)...)
	rows, err := s.db.QueryContext(ctx, `
		SELECT run_id, operation_id FROM runs
		WHERE run_id IN (`+placeholders+`) OR operation_id IN (`+placeholders+`)
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	requestedSet := map[string]struct{}{}
	for _, id := range requested {
		requestedSet[id] = struct{}{}
	}
	resolved := map[string]string{}
	for rows.Next() {
		var runID, operationID string
		if err := rows.Scan(&runID, &operationID); err != nil {
			return nil, err
		}
		for _, candidate := range []string{runID, operationID} {
			if _, wanted := requestedSet[candidate]; wanted {
				if _, exists := resolved[candidate]; !exists {
					resolved[candidate] = operationID
				}
			}
		}
	}
	return resolved, rows.Err()
}

func operationMemberRunIDs(ctx context.Context, tx *sql.Tx, operationIDs []string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT run_id FROM runs WHERE operation_id IN (`+queryPlaceholders(len(operationIDs))+`)`, queryArgs(operationIDs)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var runIDs []string
	for rows.Next() {
		var runID string
		if err := rows.Scan(&runID); err != nil {
			return nil, err
		}
		runIDs = append(runIDs, runID)
	}
	return runIDs, rows.Err()
}

func maxRevision(revisions map[string]int64) int64 {
	var highest int64
	for _, revision := range revisions {
		if revision > highest {
			highest = revision
		}
	}
	return highest
}

// ResolveRunIDs resolves exact member-run or operation ids to a member run
// without inferring identity from W3C trace correlation.
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
		SELECT run_id, operation_id
		FROM runs
		WHERE run_id IN (`+placeholders+`) OR operation_id IN (`+placeholders+`)
		ORDER BY CASE WHEN run_id = operation_id THEN 0 ELSE 1 END, ifnull(started_at, ''), run_id
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	resolved := map[string]string{}
	for rows.Next() {
		var runID, operationID string
		if err := rows.Scan(&runID, &operationID); err != nil {
			return nil, err
		}
		if _, ok := requestedSet[runID]; ok {
			resolved[runID] = runID
		}
		if _, ok := requestedSet[operationID]; ok {
			if _, alreadyResolved := resolved[operationID]; !alreadyResolved {
				resolved[operationID] = runID
			}
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
	if err := s.enrichRunSegmentSummaries(ctx, []string{run.RunID}, map[string]*RunSummary{run.RunID: run}); err != nil {
		return fmt.Errorf("enrich observability run %q segments: %w", run.RunID, err)
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
			defaultPartialOrderingConfidence(byRunID)
			return nil
		}
		return err
	}
	if err := s.enrichRunSegmentSummaries(ctx, runIDs, byRunID); err != nil {
		if !includeExpensiveRollups && isRunListDeadlineError(err) {
			defaultPartialOrderingConfidence(byRunID)
			return nil
		}
		return err
	}
	if err := s.enrichRunSummaryIdentities(ctx, runIDs, byRunID); err != nil {
		if !includeExpensiveRollups && isRunListDeadlineError(err) {
			defaultPartialOrderingConfidence(byRunID)
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

func defaultPartialOrderingConfidence(byRunID map[string]*RunSummary) {
	for _, run := range byRunID {
		if run.OrderingConfidence == "" {
			run.OrderingConfidence = "partial"
		}
	}
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
		ORDER BY started_at, span_id
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

	run, err := s.loadRunSummary(ctx, canonicalRunID, true)
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
	graphRuns := []RunSummary{run}
	byRunID := map[string]*RunSummary{canonicalRunID: &graphRuns[0]}
	if err := s.enrichRunSegmentSummaries(ctx, []string{canonicalRunID}, byRunID); err != nil {
		return Graph{}, fmt.Errorf("enrich observability run %q segments: %w", runID, err)
	}
	if err := s.enrichRunDeliveryHealth(ctx, graphRuns); err != nil {
		return Graph{}, err
	}
	run = graphRuns[0]

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

	canonicalRunID, err := s.resolveRunID(ctx, runID)
	if err != nil {
		return RunDetail{}, err
	}
	selected, err := s.loadRunSummary(ctx, canonicalRunID, false)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return RunDetail{}, fmt.Errorf("run %q: %w", runID, ErrNotFound)
		}
		return RunDetail{}, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT run_id, ifnull(parent_run_id, ''), ifnull(triggered_by_span_id, '')
		FROM runs WHERE operation_id = ?
		ORDER BY CASE WHEN run_id = operation_id THEN 0 ELSE 1 END, ifnull(started_at, ''), run_id
	`, selected.OperationID)
	if err != nil {
		return RunDetail{}, err
	}
	type memberRef struct{ runID, parentRunID, triggeredBySpanID string }
	var memberRefs []memberRef
	for rows.Next() {
		var member memberRef
		if err := rows.Scan(&member.runID, &member.parentRunID, &member.triggeredBySpanID); err != nil {
			rows.Close()
			return RunDetail{}, err
		}
		memberRefs = append(memberRefs, member)
	}
	if err := rows.Close(); err != nil {
		return RunDetail{}, err
	}

	var detail RunDetail
	allDefinitionRefs := []DefinitionRef{}
	memberDetails := make([]RunDetail, 0, len(memberRefs))
	memberProjections := make([]OperationRunDetail, 0, len(memberRefs))
	for _, member := range memberRefs {
		graph, err := s.graph(ctx, member.runID, true)
		if err != nil {
			return RunDetail{}, err
		}
		memberDetail := ProjectRunDetail(graph, DefaultProjectionOptions())
		definitionRefs, err := s.projectRunDefinitionRefs(ctx, graph.Run.RunID)
		if err != nil {
			return RunDetail{}, fmt.Errorf("list definition refs for run %q: %w", member.runID, err)
		}
		attachRunDetailDefinitionRefs(&memberDetail.Root, definitionRefs.BySpan)
		allDefinitionRefs = append(allDefinitionRefs, definitionRefs.Run...)
		memberDetails = append(memberDetails, memberDetail)
		memberProjection := OperationRunDetail{
			Run:               memberDetail.Run,
			ParentRunID:       member.parentRunID,
			TriggeredBySpanID: member.triggeredBySpanID,
			Root:              memberDetail.Root,
			Diagnostics:       memberDetail.Diagnostics,
		}
		if member.runID == selected.OperationID {
			detail = memberDetail
		}
		memberProjections = append(memberProjections, memberProjection)
	}
	if detail.Run.RunID == "" {
		detail = ProjectRunDetail(Graph{Run: RunSummary{
			RunID: selected.OperationID, OperationID: selected.OperationID, RootRunID: selected.OperationID,
			Name: "Incomplete operation", Status: "incomplete",
		}}, DefaultProjectionOptions())
	}
	detail.MemberRuns = memberProjections
	aggregateOperationDetail(&detail, memberDetails)
	mountOperationMemberRuns(&detail)
	detail.DefinitionRefs = uniqueDefinitionRefs(allDefinitionRefs)
	detail.Diagnostics = append(detail.Diagnostics, s.operationTopologyDiagnostics(ctx, selected.OperationID)...)
	operationByID := map[string]*RunSummary{selected.OperationID: &detail.Run}
	if err := s.enrichOperationTopologyBatch(ctx, []string{selected.OperationID}, operationByID); err != nil {
		return RunDetail{}, err
	}

	resolution, err := s.resolveRunManifest(ctx, detail.Run, detail.DefinitionRefs, "")
	if err != nil {
		return RunDetail{}, err
	}
	detail.Manifest = &resolution
	return detail, nil
}

func aggregateOperationDetail(detail *RunDetail, members []RunDetail) {
	rootStatus := detail.Run.Status
	detail.Counts = RunDetailCounts{}
	detail.Facets = map[string]map[string]int{}
	detail.Run.RecordCount = 0
	detail.Run.SpanCount = 0
	detail.Run.EventCount = 0
	detail.Run.ArtifactCount = 0
	detail.Run.EdgeCount = 0
	detail.Run.ChildRunCount = 0
	detail.Run.ActiveChildCount = 0
	detail.Run.SuspendedChildCount = 0
	detail.Run.FailedChildCount = 0
	metrics := map[string]float64{}
	var familyRedaction *ObservabilityRedactionEvidence
	for _, member := range members {
		familyRedaction = mergeRedactionEvidence(familyRedaction, member.Redaction)
		detail.Counts.Primary += member.Counts.Primary
		detail.Counts.Detail += member.Counts.Detail
		detail.Counts.Metadata += member.Counts.Metadata
		detail.Counts.AttachedDetails += member.Counts.AttachedDetails
		mergeRunDetailFacets(detail.Facets, member.Facets)
		detail.Run.RecordCount += member.Run.RecordCount
		detail.Run.SpanCount += member.Run.SpanCount
		detail.Run.EventCount += member.Run.EventCount
		detail.Run.ArtifactCount += member.Run.ArtifactCount
		detail.Run.EdgeCount += member.Run.EdgeCount
		addMetrics(metrics, numericMetricsFromRaw(member.Run.Metrics))
		if member.Run.RunID == detail.Run.OperationID {
			continue
		}
		detail.Run.ChildRunCount++
		switch member.Run.Status {
		case "running":
			detail.Run.ActiveChildCount++
		case "suspended":
			detail.Run.SuspendedChildCount++
		case "error", "failed", "blocked", "cancelled", "conflicted", "incomplete":
			detail.Run.FailedChildCount++
		}
	}
	normalizeUsageTotals(metrics)
	detail.Run.Metrics = metricsRawOrNil(metrics)
	detail.Redaction = familyRedaction
	detail.Root.Redaction = familyRedaction
	detail.Run.Status = rootStatus
	detail.Run.RootRunID = detail.Run.OperationID
	detail.Run.RootPresent = rootStatus != "incomplete" || detail.Run.Name != "Incomplete operation"
}

func mergeRunDetailFacets(target, source map[string]map[string]int) {
	for facet, values := range source {
		if target[facet] == nil {
			target[facet] = map[string]int{}
		}
		for value, count := range values {
			target[facet][value] += count
		}
	}
}

func mountOperationMemberRuns(detail *RunDetail) {
	pending := make([]OperationRunDetail, 0, len(detail.MemberRuns))
	for _, member := range detail.MemberRuns {
		if member.Run.RunID != detail.Run.OperationID {
			pending = append(pending, member)
		}
	}
	for len(pending) > 0 {
		progress := false
		remaining := pending[:0]
		for _, member := range pending {
			parent := findOperationRunRoot(&detail.Root, member.ParentRunID)
			if member.ParentRunID == detail.Run.OperationID {
				parent = &detail.Root
			}
			if parent == nil {
				remaining = append(remaining, member)
				continue
			}
			target := findOperationTriggerNode(parent, member.TriggeredBySpanID, member.ParentRunID)
			if target == nil {
				target = parent
			}
			target.Children = append(target.Children, member.Root)
			progress = true
		}
		pending = remaining
		if progress {
			continue
		}
		for _, member := range pending {
			detail.Root.Children = append(detail.Root.Children, member.Root)
		}
		break
	}
	applyRunDetailRollups(&detail.Root)
	resetRunDetailIndex(&detail.Root, detail.SpanIndex)
	detail.Rows = flattenRunDetailRows(detail.Root)
}

func findOperationRunRoot(node *RunDetailNode, runID string) *RunDetailNode {
	if runID == "" {
		return nil
	}
	if node.Virtual && node.RunID == runID {
		return node
	}
	for index := range node.Children {
		if found := findOperationRunRoot(&node.Children[index], runID); found != nil {
			return found
		}
	}
	return nil
}

func findOperationTriggerNode(node *RunDetailNode, spanID, runID string) *RunDetailNode {
	if spanID == "" {
		return nil
	}
	if node.SpanID == spanID && node.RunID == runID {
		return node
	}
	for index := range node.Children {
		if found := findOperationTriggerNode(&node.Children[index], spanID, runID); found != nil {
			return found
		}
	}
	return nil
}

func uniqueDefinitionRefs(refs []DefinitionRef) []DefinitionRef {
	seen := map[string]struct{}{}
	out := make([]DefinitionRef, 0, len(refs))
	for _, ref := range refs {
		key := ref.ID + "\x00" + ref.Kind + "\x00" + ref.Role
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, ref)
	}
	return out
}

func attachRunDetailDefinitionRefs(node *RunDetailNode, refsBySpan map[string][]DefinitionRef) {
	node.DefinitionRefs = refsBySpan[node.SpanID]
	for index := range node.Details {
		node.Details[index].DefinitionRefs = refsBySpan[node.Details[index].SpanID]
	}
	for index := range node.Children {
		attachRunDetailDefinitionRefs(&node.Children[index], refsBySpan)
	}
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
		ORDER BY started_at, span_id
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
		WITH RECURSIVE segment_order(segment_id, depth, path) AS (
			SELECT segment_id, 0, '|' || segment_id || '|'
			FROM run_segments
			WHERE run_id = ? AND (previous_segment_id IS NULL OR previous_segment_id = '')
			UNION ALL
			SELECT child.segment_id, parent.depth + 1, parent.path || child.segment_id || '|'
			FROM run_segments child
			JOIN segment_order parent ON child.previous_segment_id = parent.segment_id
			WHERE child.run_id = ? AND instr(parent.path, '|' || child.segment_id || '|') = 0
		)
		SELECT r.record_id, r.run_id, r.operation_id, ifnull(r.trace_id, ''), r.segment_id, r.segment_seq, r.type, r.payload_json, r.received_at
		FROM records r
		LEFT JOIN segment_order ordering ON ordering.segment_id = r.segment_id
		WHERE r.run_id = ?
		ORDER BY
			CASE WHEN EXISTS(SELECT 1 FROM records start WHERE start.segment_id = r.segment_id AND start.type = 'run:start') THEN 0 ELSE 1 END,
			coalesce(ordering.depth, 2147483647),
			r.segment_id,
			r.segment_seq,
			coalesce(
				json_extract(r.payload_json, '$.startedAt'),
				json_extract(r.payload_json, '$.resumedAt'),
				json_extract(r.payload_json, '$.suspendedAt'),
				json_extract(r.payload_json, '$.endedAt'),
				json_extract(r.payload_json, '$.timestamp'),
				json_extract(r.payload_json, '$.createdAt'),
				r.received_at
			),
			r.record_id
	`, runID, runID, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []StoredRecord
	for rows.Next() {
		var record StoredRecord
		if err := rows.Scan(
			&record.RecordID,
			&record.RunID,
			&record.OperationID,
			&record.TraceID,
			&record.SegmentID,
			&record.SegmentSeq,
			&record.Type,
			&record.PayloadJSON,
			&record.ReceivedAt,
		); err != nil {
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
