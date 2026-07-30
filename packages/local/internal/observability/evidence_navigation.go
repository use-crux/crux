package observability

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

// ResolveEvidenceNavigation resolves retained graph provenance positionally
// from one consistent Local read snapshot.
func (s *Service) ResolveEvidenceNavigation(
	ctx context.Context,
	request EvidenceNavigationRequest,
) (EvidenceNavigationResponse, error) {
	if len(request.Refs) > maxEvidenceBatchSubjects {
		return EvidenceNavigationResponse{}, fmt.Errorf(
			"%w: refs must contain at most %d entries",
			ErrEvidenceInputInvalid,
			maxEvidenceBatchSubjects,
		)
	}
	for _, ref := range request.Refs {
		if !validEvidenceNavigationRef(ref) {
			return EvidenceNavigationResponse{}, fmt.Errorf(
				"%w: graph ref is invalid",
				ErrEvidenceInputInvalid,
			)
		}
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return EvidenceNavigationResponse{}, fmt.Errorf(
			"begin evidence navigation: %w",
			err,
		)
	}
	defer tx.Rollback()
	cache := make(map[string]EvidenceNavigationResult)
	results := make([]EvidenceNavigationResult, 0, len(request.Refs))
	for _, ref := range request.Refs {
		key := ref.Kind + "\x00" + ref.ID
		if cached, ok := cache[key]; ok {
			results = append(results, cached)
			continue
		}
		result, err := resolveEvidenceNavigationRef(ctx, tx, ref)
		if err != nil {
			return EvidenceNavigationResponse{}, err
		}
		cache[key] = result
		results = append(results, result)
	}
	if err := tx.Commit(); err != nil {
		return EvidenceNavigationResponse{}, fmt.Errorf(
			"commit evidence navigation: %w",
			err,
		)
	}
	return EvidenceNavigationResponse{Results: results}, nil
}

func resolveEvidenceNavigationRef(
	ctx context.Context,
	tx *sql.Tx,
	ref NodeRef,
) (EvidenceNavigationResult, error) {
	var target *EvidenceNavigationTarget
	var err error
	switch ref.Kind {
	case "run":
		target, err = resolveEvidenceRunNavigation(ctx, tx, ref.ID)
	case "span":
		target, err = resolveEvidenceSpanNavigation(ctx, tx, ref.ID)
	case "artifact":
		target, err = resolveEvidenceArtifactNavigation(ctx, tx, ref.ID)
	case "effect.receipt":
		// Effect receipt navigation waits for #196's canonical projection.
	}
	if err != nil {
		return EvidenceNavigationResult{}, err
	}
	if target != nil {
		return EvidenceNavigationResult{
			Ref:    ref,
			Status: "resolved",
			Target: target,
		}, nil
	}
	reason, err := evidenceNavigationUnavailableReason(ctx, tx, ref)
	if err != nil {
		return EvidenceNavigationResult{}, err
	}
	return EvidenceNavigationResult{
		Ref:    ref,
		Status: "unavailable",
		Reason: reason,
	}, nil
}

func resolveEvidenceRunNavigation(
	ctx context.Context,
	tx *sql.Tx,
	runID string,
) (*EvidenceNavigationTarget, error) {
	var traceID sql.NullString
	err := tx.QueryRowContext(ctx, `
		SELECT trace_id FROM runs WHERE run_id = ?
	`, runID).Scan(&traceID)
	if err == sql.ErrNoRows || !traceID.Valid || traceID.String == "" {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("resolve evidence run navigation: %w", err)
	}
	refs, err := retainedDefinitionRefs(ctx, tx, runID, "")
	if err != nil {
		return nil, err
	}
	return &EvidenceNavigationTarget{
		Kind:                   "run",
		RunID:                  runID,
		TraceID:                traceID.String,
		RetainedDefinitionRefs: &refs,
	}, nil
}

func resolveEvidenceSpanNavigation(
	ctx context.Context,
	tx *sql.Tx,
	spanID string,
) (*EvidenceNavigationTarget, error) {
	var runID string
	var traceID sql.NullString
	err := tx.QueryRowContext(ctx, `
		SELECT run_id, trace_id FROM spans WHERE span_id = ?
	`, spanID).Scan(&runID, &traceID)
	if err == sql.ErrNoRows || !traceID.Valid || traceID.String == "" {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("resolve evidence span navigation: %w", err)
	}
	refs, err := retainedDefinitionRefs(ctx, tx, runID, spanID)
	if err != nil {
		return nil, err
	}
	return &EvidenceNavigationTarget{
		Kind:                   "span",
		SpanID:                 spanID,
		RunID:                  runID,
		TraceID:                traceID.String,
		RetainedDefinitionRefs: &refs,
	}, nil
}

func resolveEvidenceArtifactNavigation(
	ctx context.Context,
	tx *sql.Tx,
	artifactID string,
) (*EvidenceNavigationTarget, error) {
	var runID string
	var traceID, spanID sql.NullString
	err := tx.QueryRowContext(ctx, `
		SELECT run_id, trace_id, span_id
		FROM artifacts WHERE artifact_id = ?
	`, artifactID).Scan(&runID, &traceID, &spanID)
	if err == sql.ErrNoRows || !traceID.Valid || traceID.String == "" {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("resolve evidence artifact navigation: %w", err)
	}
	owner := &EvidenceNavigationOwner{Kind: "run", RunID: runID}
	ownerSpanID := ""
	if spanID.Valid && spanID.String != "" {
		owner.Kind = "span"
		owner.SpanID = spanID.String
		ownerSpanID = spanID.String
	}
	refs, err := retainedDefinitionRefs(ctx, tx, runID, ownerSpanID)
	if err != nil {
		return nil, err
	}
	owner.RetainedDefinitionRefs = refs
	return &EvidenceNavigationTarget{
		Kind:       "artifact",
		ArtifactID: artifactID,
		RunID:      runID,
		TraceID:    traceID.String,
		Owner:      owner,
	}, nil
}

func retainedDefinitionRefs(
	ctx context.Context,
	queryer evidenceQueryer,
	runID string,
	spanID string,
) ([]DefinitionRef, error) {
	rows, err := queryer.QueryContext(ctx, `
		SELECT payload_json FROM records
		WHERE run_id = ? AND type IN ('run:start', 'span:start', 'span')
		ORDER BY segment_seq, record_id
	`, runID)
	if err != nil {
		return nil, fmt.Errorf("load retained definition refs: %w", err)
	}
	defer rows.Close()
	refs := make([]DefinitionRef, 0)
	positions := make(map[definitionRefKey]int)
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		var envelope definitionRefsEnvelope
		if err := json.Unmarshal(payload, &envelope); err != nil {
			continue
		}
		if envelope.SpanID != spanID {
			continue
		}
		for _, ref := range envelope.DefinitionRefs {
			if ref.ID != "" {
				refs, positions = appendDefinitionRef(refs, positions, ref)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return refs, nil
}
