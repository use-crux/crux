package observability

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

func compactEvidenceArtifactRecords(
	ctx context.Context,
	statements *ingestStatements,
	evidenceID string,
	artifactID string,
) error {
	rows, err := statements.tx.QueryContext(ctx, `
		SELECT record_id, payload_json
		FROM records
		WHERE type = 'artifact'
		  AND json_extract(payload_json, '$.artifactId') = ?
		  AND json_extract(
			payload_json,
			'$.attributes.evidenceSource.evidenceId'
		  ) = ?
	`, artifactID, evidenceID)
	if err != nil {
		return fmt.Errorf("load evidence artifact records for compaction: %w", err)
	}
	defer rows.Close()
	type storedRecord struct {
		id      string
		payload string
	}
	records := make([]storedRecord, 0, 1)
	for rows.Next() {
		var record storedRecord
		if err := rows.Scan(&record.id, &record.payload); err != nil {
			return err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, record := range records {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal([]byte(record.payload), &fields); err != nil {
			return fmt.Errorf("decode evidence artifact record: %w", err)
		}
		if _, hasPreview := fields["preview"]; !hasPreview {
			continue
		}
		var evidenceRecord Record
		if err := json.Unmarshal(
			[]byte(record.payload),
			&evidenceRecord,
		); err != nil {
			return fmt.Errorf("decode evidence artifact identity: %w", err)
		}
		if err := persistEvidencePayloadRecordDigestIfMissing(
			ctx,
			statements,
			evidenceID,
			evidenceRecord,
		); err != nil {
			return err
		}
		delete(fields, "preview")
		compacted, err := json.Marshal(fields)
		if err != nil {
			return fmt.Errorf("encode compacted evidence artifact: %w", err)
		}
		if _, err := statements.exec(ctx, `
			UPDATE records SET payload_json = ? WHERE record_id = ?
		`, string(compacted), record.id); err != nil {
			return fmt.Errorf("compact evidence artifact record: %w", err)
		}
	}
	return nil
}

func compactExpiringEvidenceArtifact(
	ctx context.Context,
	statements *ingestStatements,
	evidenceID string,
	artifactID string,
) error {
	if _, err := statements.exec(ctx, `
		UPDATE artifacts SET preview_json = NULL
		WHERE artifact_id = ?
		  AND json_extract(
			attributes_json,
			'$.evidenceSource.evidenceId'
		  ) = ?
	`, artifactID, evidenceID); err != nil {
		return fmt.Errorf("compact expiring evidence artifact preview: %w", err)
	}
	return compactEvidenceArtifactRecords(
		ctx,
		statements,
		evidenceID,
		artifactID,
	)
}

func deleteUnreferencedEvidenceArtifact(
	ctx context.Context,
	statements *ingestStatements,
	evidenceID string,
	artifactID string,
) (string, error) {
	var referenced int
	if err := statements.queryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM edges
			WHERE (from_kind = 'artifact' AND from_id = ?)
			   OR (to_kind = 'artifact' AND to_id = ?)
		)
	`, artifactID, artifactID).Scan(&referenced); err != nil {
		return "", fmt.Errorf(
			"check retained evidence artifact references: %w",
			err,
		)
	}
	if referenced != 0 {
		return "", nil
	}
	var artifactRunID string
	if err := statements.queryRow(ctx, `
		SELECT run_id FROM artifacts
		WHERE artifact_id = ?
		  AND json_extract(
			attributes_json,
			'$.evidenceSource.evidenceId'
		  ) = ?
	`, artifactID, evidenceID).Scan(&artifactRunID); err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", fmt.Errorf(
			"check retained evidence artifact ownership: %w",
			err,
		)
	}
	if _, err := statements.exec(ctx, `
		DELETE FROM records
		WHERE type = 'artifact'
		  AND json_extract(payload_json, '$.artifactId') = ?
		  AND json_extract(
			payload_json,
			'$.attributes.evidenceSource.evidenceId'
		  ) = ?
	`, artifactID, evidenceID); err != nil {
		return "", fmt.Errorf(
			"delete retained evidence artifact record: %w",
			err,
		)
	}
	if _, err := statements.exec(
		ctx,
		`DELETE FROM artifacts WHERE artifact_id = ?`,
		artifactID,
	); err != nil {
		return "", fmt.Errorf("delete retained evidence artifact: %w", err)
	}
	return artifactRunID, nil
}
