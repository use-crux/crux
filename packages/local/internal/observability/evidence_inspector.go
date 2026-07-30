package observability

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

var (
	// ErrEvidenceNotFound means Local has no trustworthy identity for a subject.
	ErrEvidenceNotFound = errors.New("evidence subject not found")
	// ErrEvidenceInputInvalid identifies a malformed bounded inspect request.
	ErrEvidenceInputInvalid = errors.New("evidence inspect input invalid")
)

var evidenceRoleOrder = []string{
	"intent",
	"authority",
	"change",
	"verification",
	"recovery",
}

const evidenceReadCleanupInterval = time.Minute

type evidenceQueryer interface {
	QueryContext(
		context.Context,
		string,
		...any,
	) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// InspectEvidence reads Local's canonical durable evidence projection.
func (s *Service) InspectEvidence(
	ctx context.Context,
	request EvidenceInspectRequest,
) (EvidenceInspectResult, error) {
	if request.Limit < 1 || request.Limit > 50 {
		return EvidenceInspectResult{}, fmt.Errorf(
			"%w: limit must be 1..50",
			ErrEvidenceInputInvalid,
		)
	}
	if request.Role != "" {
		if _, valid := evidenceRoles[request.Role]; !valid {
			return EvidenceInspectResult{}, fmt.Errorf(
				"%w: role is invalid",
				ErrEvidenceInputInvalid,
			)
		}
	}
	if request.Cursor != "" && request.Role == "" {
		return EvidenceInspectResult{}, ErrEvidenceCursorInvalid
	}
	s.applyEvidenceReadRetention(ctx)
	now := s.evidenceNow().UTC()
	relationshipCutoff := formatEvidenceAcceptanceTime(now.Add(
		-s.evidenceSettings.RelationshipRetention,
	))
	payloadCutoff := formatEvidenceAcceptanceTime(now.Add(
		-s.evidenceSettings.PayloadRetention,
	))
	transaction, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return EvidenceInspectResult{}, fmt.Errorf(
			"begin evidence inspection: %w",
			err,
		)
	}
	defer transaction.Rollback()
	subjectKind, err := resolveEvidenceInspectSubject(
		ctx,
		transaction,
		request.Subject,
	)
	if err != nil {
		return EvidenceInspectResult{}, err
	}
	revision, err := evidenceSubjectRevision(
		ctx,
		transaction,
		subjectKind,
		request.Subject.ID,
	)
	if err != nil {
		return EvidenceInspectResult{}, err
	}
	validUntil, err := loadEvidenceCursorValidUntil(
		ctx,
		transaction,
		subjectKind,
		request.Subject.ID,
		now,
		s.evidenceSettings,
	)
	if err != nil {
		return EvidenceInspectResult{}, err
	}
	binding := evidenceCursorBinding{
		subjectKind: subjectKind,
		subjectID:   request.Subject.ID,
		revision:    revision,
		validUntil:  validUntil,
		now:         now,
	}
	cursor, err := decodeEvidenceCursor(request, binding)
	if err != nil {
		return EvidenceInspectResult{}, err
	}
	summaries, err := loadEvidenceRoleSummaries(
		ctx,
		transaction,
		subjectKind,
		request.Subject.ID,
		relationshipCutoff,
		payloadCutoff,
	)
	if err != nil {
		return EvidenceInspectResult{}, err
	}
	if s.evidenceInspectAfterSummaries != nil {
		s.evidenceInspectAfterSummaries()
	}
	pages := make(map[string][]evidenceRelationshipRow)
	for _, role := range evidenceRoleOrder {
		if request.Role != "" && request.Role != role {
			continue
		}
		page, err := loadEvidenceRelationshipPage(
			ctx,
			transaction,
			subjectKind,
			request.Subject.ID,
			role,
			request.IncludeHistory,
			cursor,
			request.Limit,
			relationshipCutoff,
			payloadCutoff,
		)
		if err != nil {
			return EvidenceInspectResult{}, err
		}
		pages[role] = page
	}
	coverage, truncated, err := loadEvidenceInspectMetadata(
		ctx,
		transaction,
		subjectKind,
		request.Subject.ID,
		relationshipCutoff,
	)
	if err != nil {
		return EvidenceInspectResult{}, err
	}
	result, err := projectEvidenceInspectResult(
		request,
		pages,
		summaries,
		coverage,
		truncated,
		cursor,
		binding,
	)
	if err != nil {
		return EvidenceInspectResult{}, err
	}
	if err := transaction.Commit(); err != nil {
		return EvidenceInspectResult{}, fmt.Errorf(
			"commit evidence inspection: %w",
			err,
		)
	}
	return result, nil
}

func (s *Service) applyEvidenceReadRetention(ctx context.Context) {
	now := s.evidenceNow().UTC()
	next := now.UnixNano()
	previous := s.evidenceReadCleanupAt.Load()
	if previous != 0 &&
		now.Sub(time.Unix(0, previous)) < evidenceReadCleanupInterval {
		return
	}
	if !s.evidenceReadCleanupAt.CompareAndSwap(previous, next) {
		return
	}
	// Physical cleanup is best-effort. The read SQL independently enforces
	// logical expiry, so maintenance contention or corruption must not turn
	// an otherwise authorized inspection into a hard failure.
	_ = s.cleanupExpiredEvidencePayloads(ctx, now)
	_ = s.cleanupExpiredEvidenceCoverage(ctx, now)
	_ = s.cleanupExpiredEvidenceRelationships(ctx, now)
}
