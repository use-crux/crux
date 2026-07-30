package observability

import (
	"context"
	"database/sql"
	"fmt"
)

const evidenceSpanTerminalQuery = `
	SELECT EXISTS (
		SELECT 1 FROM records
			WHERE run_id = (
				SELECT run_id FROM spans WHERE span_id = ?
			)
			  AND json_extract(payload_json, '$.spanId') = ?
			  AND (
				(
					type = 'span:end'
					AND json_extract(payload_json, '$.status') IN (
						'ok', 'error', 'blocked', 'cancelled',
						'skipped', 'suspended'
					)
				)
				OR (
					type = 'span'
					AND json_extract(payload_json, '$.endedAt') != ''
					AND json_extract(payload_json, '$.status') IN (
						'ok', 'error', 'blocked', 'cancelled',
						'skipped', 'suspended'
					)
				)
			  )
	)
`

// acceptedAfterTerminalEvidenceSubject reads only previously persisted,
// explicit lifecycle records. It never consults reconciled rollups or caller
// timestamps and is called exactly once for a first-winning relationship.
func acceptedAfterTerminalEvidenceSubject(
	ctx context.Context,
	statements *ingestStatements,
	subject NodeRef,
) (sql.NullString, sql.NullString, error) {
	var exists int
	switch subject.Kind {
	case "run":
		if err := statements.queryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM records
				WHERE type = 'run:end' AND run_id = ?
				  AND json_extract(payload_json, '$.status')
					IN ('ok', 'error', 'blocked', 'cancelled')
			)
		`, subject.ID).Scan(&exists); err != nil {
			return sql.NullString{}, sql.NullString{},
				fmt.Errorf("inspect explicit run terminal: %w", err)
		}
	case "span":
		if err := statements.queryRow(
			ctx,
			evidenceSpanTerminalQuery,
			subject.ID,
			subject.ID,
		).Scan(&exists); err != nil {
			return sql.NullString{}, sql.NullString{},
				fmt.Errorf("inspect explicit span terminal: %w", err)
		}
	default:
		return sql.NullString{}, sql.NullString{}, nil
	}
	if exists == 0 {
		return sql.NullString{}, sql.NullString{}, nil
	}
	return sql.NullString{String: subject.Kind, Valid: true},
		sql.NullString{String: subject.ID, Valid: true},
		nil
}
