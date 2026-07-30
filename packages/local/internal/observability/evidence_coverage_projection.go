package observability

import (
	"context"
	"encoding/json"
	"fmt"
)

const evidenceCoverageConflictCode = "EVIDENCE_COVERAGE_CONFLICT"

// projectEvidenceCoverageEvent persists the event and normalized support set
// in the same transaction as its canonical span event.
func (s *Service) projectEvidenceCoverageEvent(
	ctx context.Context,
	statements *ingestStatements,
	event SpanEventRecord,
) error {
	if event.Name != "evidence.coverage" {
		return nil
	}
	var attributes evidenceCoverageEventAttributes
	if err := json.Unmarshal(event.Attributes, &attributes); err != nil {
		return fmt.Errorf("decode evidence coverage projection: %w", err)
	}
	acceptedAt := s.evidenceNow().UTC()
	expiresAt := acceptedAt.Add(s.evidenceSettings.RelationshipRetention)
	result, err := statements.exec(ctx, `
		INSERT INTO evidence_coverage_events (
			authorization_namespace, event_id, record_id, run_id,
			producer_span_id, subject_kind, subject_id, role, status,
			accepted_at, expires_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (authorization_namespace, event_id) DO NOTHING
	`, localEvidenceAuthorizationNamespace, event.EventID, event.RecordID,
		event.RunID, event.SpanID, attributes.Subject.Kind,
		attributes.Subject.ID, attributes.Role, attributes.Status,
		formatEvidenceAcceptanceTime(acceptedAt),
		formatEvidenceAcceptanceTime(expiresAt))
	if err != nil {
		return fmt.Errorf("persist evidence coverage event: %w", err)
	}
	inserted, err := rowsAffected(result)
	if err != nil || !inserted {
		return err
	}
	if _, err := statements.exec(ctx, `
		INSERT INTO evidence_coverage_projection (
			authorization_namespace, subject_kind, subject_id, role, status,
			support_count, first_accepted_at, last_accepted_at
		) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
		ON CONFLICT (
			authorization_namespace, subject_kind, subject_id, role, status
		) DO UPDATE SET
			support_count = support_count + 1,
			last_accepted_at = excluded.last_accepted_at
	`, localEvidenceAuthorizationNamespace, attributes.Subject.Kind,
		attributes.Subject.ID, attributes.Role, attributes.Status,
		formatEvidenceAcceptanceTime(acceptedAt),
		formatEvidenceAcceptanceTime(acceptedAt)); err != nil {
		return fmt.Errorf("project evidence coverage: %w", err)
	}
	if err := bumpEvidenceSubjectRevision(
		ctx,
		statements,
		attributes.Subject.Kind,
		attributes.Subject.ID,
	); err != nil {
		return err
	}
	var statusCount int
	if err := statements.queryRow(ctx, `
		SELECT count(*) FROM evidence_coverage_projection
		WHERE authorization_namespace = ? AND subject_kind = ?
		  AND subject_id = ? AND role = ?
	`, localEvidenceAuthorizationNamespace, attributes.Subject.Kind,
		attributes.Subject.ID, attributes.Role).Scan(&statusCount); err != nil {
		return fmt.Errorf("count evidence coverage statuses: %w", err)
	}
	if statusCount > 1 {
		return recordEvidenceIngestHealth(
			ctx,
			statements,
			evidenceCoverageConflictCode,
			1,
			acceptedAt,
		)
	}
	return nil
}
