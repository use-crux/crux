package observability

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

func (s *Service) materializeEvidenceArtifact(
	ctx context.Context,
	statements *ingestStatements,
	record Record,
	artifact ArtifactRecord,
) error {
	if err := validateEvidenceRecordAdmission(ctx, statements, record); err != nil {
		return err
	}
	storedInserted, err := upsertStoredRecord(ctx, statements, record)
	if err != nil {
		return err
	}
	artifactInserted, err := insertImmutableEvidenceArtifact(
		ctx,
		statements,
		artifact,
	)
	if err != nil {
		return err
	}
	if !storedInserted {
		return nil
	}
	if err := upsertRunDeployment(
		ctx,
		statements,
		record.RunID,
		record.Deployment,
	); err != nil {
		return err
	}
	statements.markAffected(record.OperationID, record.RunID, record.SegmentID)
	if err := projectDefinitionActivity(ctx, statements, record); err != nil {
		return err
	}
	return updateRunRollups(
		ctx,
		statements,
		rollupDeltaForArtifact(artifact, storedInserted, artifactInserted),
	)
}

func insertImmutableEvidenceArtifact(
	ctx context.Context,
	statements *ingestStatements,
	artifact ArtifactRecord,
) (bool, error) {
	existing, err := loadStoredArtifact(ctx, statements, artifact.ArtifactID)
	if err != nil {
		return false, err
	}
	if existing != nil {
		matches, err := sameStoredArtifact(*existing, artifact)
		if err != nil {
			return false, err
		}
		if !matches {
			return false, evidenceConflict()
		}
		return false, nil
	}
	result, err := statements.exec(ctx, `
		INSERT INTO artifacts (
			artifact_id, run_id, trace_id, span_id, kind, created_at,
			content_type, encoding, size_bytes, hash, preview_json, uri,
			attributes_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, artifact.ArtifactID, artifact.RunID, nullIfEmpty(artifact.TraceID),
		nullIfEmpty(artifact.SpanID), artifact.Kind, artifact.CreatedAt,
		artifact.ContentType, artifact.Encoding, nullInt64(artifact.SizeBytes),
		nullIfEmpty(artifact.Hash), nullJSON(artifact.Preview),
		nullIfEmpty(artifact.URI), nullJSON(artifact.Attributes))
	if err != nil {
		return false, fmt.Errorf("insert immutable evidence artifact: %w", err)
	}
	return rowsAffected(result)
}

type storedArtifact struct {
	runID       string
	traceID     sql.NullString
	spanID      sql.NullString
	kind        string
	createdAt   string
	contentType string
	encoding    string
	sizeBytes   sql.NullInt64
	hash        sql.NullString
	preview     sql.NullString
	uri         sql.NullString
	attributes  sql.NullString
}

func loadStoredArtifact(
	ctx context.Context,
	statements *ingestStatements,
	artifactID string,
) (*storedArtifact, error) {
	var artifact storedArtifact
	err := statements.queryRow(ctx, `
		SELECT run_id, trace_id, span_id, kind, created_at, content_type,
			encoding, size_bytes, hash, preview_json, uri, attributes_json
		FROM artifacts WHERE artifact_id = ?
	`, artifactID).Scan(
		&artifact.runID,
		&artifact.traceID,
		&artifact.spanID,
		&artifact.kind,
		&artifact.createdAt,
		&artifact.contentType,
		&artifact.encoding,
		&artifact.sizeBytes,
		&artifact.hash,
		&artifact.preview,
		&artifact.uri,
		&artifact.attributes,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load evidence artifact: %w", err)
	}
	return &artifact, nil
}

func sameStoredArtifact(
	stored storedArtifact,
	submitted ArtifactRecord,
) (bool, error) {
	if stored.runID != submitted.RunID ||
		stored.traceID.String != submitted.TraceID ||
		stored.spanID.String != submitted.SpanID ||
		stored.kind != submitted.Kind ||
		stored.createdAt != submitted.CreatedAt ||
		stored.contentType != submitted.ContentType ||
		stored.encoding != submitted.Encoding ||
		stored.sizeBytes.Valid != (submitted.SizeBytes != nil) ||
		(stored.sizeBytes.Valid &&
			stored.sizeBytes.Int64 != *submitted.SizeBytes) ||
		stored.hash.String != submitted.Hash ||
		stored.uri.String != submitted.URI {
		return false, nil
	}
	previewMatches, err := sameNullableJSON(stored.preview, submitted.Preview)
	if err != nil || !previewMatches {
		return previewMatches, err
	}
	return sameNullableJSON(stored.attributes, submitted.Attributes)
}

func sameNullableJSON(stored sql.NullString, submitted json.RawMessage) (bool, error) {
	if !stored.Valid {
		return len(submitted) == 0, nil
	}
	if len(submitted) == 0 {
		return false, nil
	}
	left, err := canonicalJSON([]byte(stored.String))
	if err != nil {
		return false, err
	}
	right, err := canonicalJSON(submitted)
	if err != nil {
		return false, err
	}
	return bytes.Equal(left, right), nil
}
