package observability

import (
	"context"
	"database/sql"
	"fmt"
)

func ensureEvidenceSupersessionState(
	ctx context.Context,
	tx *sql.Tx,
) error {
	rows, err := tx.QueryContext(ctx, `PRAGMA table_info(evidence_relationships)`)
	if err != nil {
		return fmt.Errorf("inspect evidence relationship columns: %w", err)
	}
	hasSuperseded := false
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(
			&cid,
			&name,
			&columnType,
			&notNull,
			&defaultValue,
			&primaryKey,
		); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan evidence relationship columns: %w", err)
		}
		hasSuperseded = hasSuperseded || name == "superseded"
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close evidence relationship columns: %w", err)
	}
	if hasSuperseded {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `
		ALTER TABLE evidence_relationships
		ADD COLUMN superseded INTEGER NOT NULL DEFAULT 0
			CHECK (superseded IN (0, 1))
	`); err != nil {
		return fmt.Errorf("add evidence supersession state: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE evidence_relationships AS predecessor
		SET superseded = 1
		WHERE EXISTS (
			SELECT 1
			FROM evidence_supersessions supersession
			JOIN evidence_relationships successor
			  ON successor.authorization_namespace =
			     supersession.authorization_namespace
			 AND successor.evidence_id = supersession.evidence_id
			WHERE supersession.authorization_namespace =
			      predecessor.authorization_namespace
			  AND supersession.superseded_evidence_id =
			      predecessor.evidence_id
			  AND successor.subject_kind = predecessor.subject_kind
			  AND successor.subject_id = predecessor.subject_id
			  AND successor.role = predecessor.role
		)
	`); err != nil {
		return fmt.Errorf("backfill evidence supersession state: %w", err)
	}
	return nil
}

func markEvidencePredecessorSuperseded(
	ctx context.Context,
	statements *ingestStatements,
	successorID string,
	predecessorID string,
	subject NodeRef,
	role string,
) error {
	if _, err := statements.exec(ctx, `
		UPDATE evidence_relationships
		SET superseded = 1
		WHERE authorization_namespace = ?
		  AND evidence_id = ?
		  AND subject_kind = ?
		  AND subject_id = ?
		  AND role = ?
	`, localEvidenceAuthorizationNamespace, predecessorID, subject.Kind,
		subject.ID, role); err != nil {
		return fmt.Errorf(
			"mark predecessor superseded by %s: %w",
			successorID,
			err,
		)
	}
	return nil
}

func evidenceRelationshipIsAlreadySuperseded(
	ctx context.Context,
	statements *ingestStatements,
	evidenceID string,
	subject NodeRef,
	role string,
) (bool, error) {
	var superseded bool
	err := statements.queryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM evidence_supersessions supersession
			JOIN evidence_relationships successor
			  ON successor.authorization_namespace =
			     supersession.authorization_namespace
			 AND successor.evidence_id = supersession.evidence_id
			WHERE supersession.authorization_namespace = ?
			  AND supersession.superseded_evidence_id = ?
			  AND successor.subject_kind = ?
			  AND successor.subject_id = ?
			  AND successor.role = ?
		)
	`, localEvidenceAuthorizationNamespace, evidenceID, subject.Kind,
		subject.ID, role).Scan(&superseded)
	if err != nil {
		return false, fmt.Errorf("resolve evidence supersession state: %w", err)
	}
	return superseded, nil
}
