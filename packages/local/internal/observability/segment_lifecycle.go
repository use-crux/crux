package observability

import (
	"context"
	"database/sql"
	"encoding/json"
)

func upsertRunBoundary(ctx context.Context, statements *ingestStatements, runID, traceID string, attributes json.RawMessage) error {
	_, err := statements.exec(ctx, `
		INSERT INTO runs (run_id, trace_id, attributes_json)
		VALUES (?, ?, ?)
		ON CONFLICT(run_id) DO UPDATE SET
			trace_id = coalesce(excluded.trace_id, runs.trace_id),
			attributes_json = CASE
				WHEN runs.attributes_json IS NOT NULL AND excluded.attributes_json IS NOT NULL THEN json_patch(runs.attributes_json, excluded.attributes_json)
				ELSE coalesce(excluded.attributes_json, runs.attributes_json)
			END
	`, runID, nullIfEmpty(traceID), nullJSON(attributes))
	return err
}

func reconcileRunSegmentLifecycle(ctx context.Context, statements *ingestStatements, runID string) error {
	rows, err := statements.tx.QueryContext(ctx, `
		SELECT ifnull(status, '')
		FROM run_segments
		WHERE run_id = ?
	`, runID)
	if err != nil {
		return err
	}
	defer rows.Close()
	running := 0
	suspended := 0
	terminalStatus := ""
	for rows.Next() {
		var status string
		if err := rows.Scan(&status); err != nil {
			return err
		}
		switch status {
		case "running":
			running++
		case "suspended":
			suspended++
		case "ok", "error", "blocked", "cancelled":
			if terminalStatus == "" {
				terminalStatus = status
			}
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	var terminalCount int
	if err := statements.queryRow(ctx, `SELECT count(*) FROM records WHERE run_id = ? AND type = 'run:end'`, runID).Scan(&terminalCount); err != nil && err != sql.ErrNoRows {
		return err
	}
	var terminalResumeConflict int
	if err := statements.queryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM run_segments terminal
			JOIN run_segments resumed ON resumed.previous_segment_id = terminal.segment_id
			WHERE terminal.run_id = ? AND terminal.status IN ('ok', 'error', 'blocked', 'cancelled')
		)
	`, runID).Scan(&terminalResumeConflict); err != nil {
		return err
	}
	status := ""
	switch {
	case terminalCount > 1 || terminalResumeConflict != 0:
		status = "conflicted"
	case terminalStatus != "":
		status = terminalStatus
	case running > 0:
		status = "running"
	case suspended > 0:
		status = "suspended"
	}
	if status == "" {
		return nil
	}
	_, err = statements.exec(ctx, `UPDATE runs SET status = ? WHERE run_id = ?`, status, runID)
	return err
}
