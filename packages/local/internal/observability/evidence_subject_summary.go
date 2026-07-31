package observability

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

const maxEvidenceBatchSubjects = 100

// SummarizeEvidenceSubjects returns one authorization-safe, positional result
// per submitted subject without hydrating evidence rows.
func (s *Service) SummarizeEvidenceSubjects(
	ctx context.Context,
	request EvidenceSubjectSummaryRequest,
) (EvidenceSubjectSummaryResponse, error) {
	if len(request.Subjects) > maxEvidenceBatchSubjects {
		return EvidenceSubjectSummaryResponse{}, fmt.Errorf(
			"%w: subjects must contain at most %d entries",
			ErrEvidenceInputInvalid,
			maxEvidenceBatchSubjects,
		)
	}
	for _, subject := range request.Subjects {
		if !validEvidenceInspectSubjectShape(subject) {
			return EvidenceSubjectSummaryResponse{}, fmt.Errorf(
				"%w: subject is invalid",
				ErrEvidenceInputInvalid,
			)
		}
	}
	s.applyEvidenceReadRetention(ctx)
	now := s.evidenceNow().UTC()
	relationshipCutoff := formatEvidenceAcceptanceTime(
		now.Add(-s.evidenceSettings.RelationshipRetention),
	)
	payloadCutoff := formatEvidenceAcceptanceTime(
		now.Add(-s.evidenceSettings.PayloadRetention),
	)
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return EvidenceSubjectSummaryResponse{}, fmt.Errorf(
			"begin evidence subject summary: %w",
			err,
		)
	}
	defer tx.Rollback()
	cache := make(map[string]EvidenceSubjectSummaryResult)
	results := make([]EvidenceSubjectSummaryResult, 0, len(request.Subjects))
	for _, subject := range request.Subjects {
		key := evidenceInspectSubjectCacheKey(subject)
		if cached, ok := cache[key]; ok {
			results = append(results, cached)
			continue
		}
		result, err := summarizeEvidenceSubject(
			ctx,
			tx,
			subject,
			relationshipCutoff,
			payloadCutoff,
		)
		if err != nil {
			return EvidenceSubjectSummaryResponse{}, err
		}
		cache[key] = result
		results = append(results, result)
	}
	if err := tx.Commit(); err != nil {
		return EvidenceSubjectSummaryResponse{}, fmt.Errorf(
			"commit evidence subject summary: %w",
			err,
		)
	}
	return EvidenceSubjectSummaryResponse{Results: results}, nil
}

func summarizeEvidenceSubject(
	ctx context.Context,
	queryer evidenceQueryer,
	subject EvidenceInspectSubject,
	relationshipCutoff string,
	payloadCutoff string,
) (EvidenceSubjectSummaryResult, error) {
	result := EvidenceSubjectSummaryResult{
		Subject: subject,
		Status:  "unavailable",
	}
	subjectKind, err := resolveEvidenceInspectSubject(ctx, queryer, subject)
	if errors.Is(err, ErrEvidenceNotFound) {
		return result, nil
	}
	if err != nil {
		return EvidenceSubjectSummaryResult{}, err
	}
	summaries, err := loadEvidenceRoleSummaries(
		ctx,
		queryer,
		subjectKind,
		subject.ID,
		relationshipCutoff,
		payloadCutoff,
	)
	if err != nil {
		return EvidenceSubjectSummaryResult{}, err
	}
	result.Status = "available"
	total := 0
	for _, role := range evidenceRoleOrder {
		total += summaries[role].activeCount
	}
	result.TotalActiveRecordCount = &total
	return result, nil
}

func validEvidenceInspectSubjectShape(subject EvidenceInspectSubject) bool {
	if subject.ID == "" {
		return false
	}
	switch subject.Kind {
	case "execution", "artifact":
		return subject.EffectID == ""
	case "effect.receipt":
		return subject.EffectID != ""
	default:
		return false
	}
}

func evidenceInspectSubjectCacheKey(subject EvidenceInspectSubject) string {
	return subject.Kind + "\x00" + subject.ID + "\x00" + subject.EffectID
}
