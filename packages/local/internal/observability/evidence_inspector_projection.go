package observability

import "fmt"

const maxEvidenceSafeInteger = 9_007_199_254_740_991

func projectEvidenceInspectResult(
	request EvidenceInspectRequest,
	pages map[string][]evidenceRelationshipRow,
	summaries map[string]evidenceRoleSummary,
	coverage map[string][]string,
	truncated map[string]bool,
	_ *evidenceCursorV1,
	binding evidenceCursorBinding,
) (EvidenceInspectResult, error) {
	roles := make(map[string]EvidenceInspectRole, len(evidenceRoleOrder))
	for _, role := range evidenceRoleOrder {
		projected, err := projectEvidenceInspectRole(
			request,
			role,
			pages[role],
			summaries[role],
			coverage[role],
			truncated[role],
			binding,
		)
		if err != nil {
			return EvidenceInspectResult{}, err
		}
		roles[role] = projected
	}
	return EvidenceInspectResult{
		Subject: request.Subject,
		Roles: EvidenceInspectRoles{
			Intent:       roles["intent"],
			Authority:    roles["authority"],
			Change:       roles["change"],
			Verification: roles["verification"],
			Recovery:     roles["recovery"],
		},
	}, nil
}

func projectEvidenceInspectRole(
	request EvidenceInspectRequest,
	role string,
	page []evidenceRelationshipRow,
	summary evidenceRoleSummary,
	coverage []string,
	watermark bool,
	binding evidenceCursorBinding,
) (EvidenceInspectRole, error) {
	if summary.activeCount < 0 ||
		int64(summary.activeCount) > int64(maxEvidenceSafeInteger) {
		return EvidenceInspectRole{}, fmt.Errorf(
			"%w: active record count is invalid",
			ErrEvidenceInputInvalid,
		)
	}
	status, explicitCoverage := evidenceRoleStatus(summary, coverage)
	result := EvidenceInspectRole{
		Role:              role,
		Status:            status,
		ActiveRecordCount: summary.activeCount,
		Records:           []EvidenceInspectRecord{},
		Conflicting: role != "intent" && summary.activeCount >= 2 &&
			summary.conflicting,
		Truncated: watermark || summary.missingHistory ||
			(request.Cursor != "" && request.Role == role),
	}
	if role != "intent" {
		result.Conclusion = summary.conclusion
	}
	if explicitCoverage {
		result.Coverage = status
	}
	hydrate := request.Role == "" || request.Role == role
	if !hydrate {
		return result, nil
	}
	hasMore := len(page) > request.Limit
	if hasMore {
		result.Truncated = true
		page = page[:request.Limit]
	}
	for _, row := range page {
		record := projectEvidenceInspectRecord(request, row)
		if row.isHistory {
			result.History = append(result.History, record)
		} else {
			result.Records = append(result.Records, record)
		}
	}
	if request.Role == role && hasMore {
		cursor, err := encodeEvidenceCursor(
			request,
			binding,
			page[len(page)-1],
		)
		if err != nil {
			return EvidenceInspectRole{}, err
		}
		result.Cursor = cursor
	}
	return result, nil
}

func evidenceRoleStatus(
	summary evidenceRoleSummary,
	coverage []string,
) (string, bool) {
	if summary.usableCount > 0 {
		return "present", false
	}
	if summary.redactedCount > 0 {
		return "redacted", false
	}
	if summary.uncapturedCount > 0 {
		return "not-captured", false
	}
	if summary.activeCount > 0 {
		return "not-captured", false
	}
	if status := restrictiveEvidenceCoverage(coverage); status != "" {
		return status, true
	}
	return "not-yet-recorded", false
}

func restrictiveEvidenceCoverage(statuses []string) string {
	for _, status := range []string{
		"redacted",
		"not-captured",
		"not-configured",
		"not-applicable",
	} {
		for _, candidate := range statuses {
			if candidate == status {
				return status
			}
		}
	}
	return ""
}

func projectEvidenceInspectRecord(
	request EvidenceInspectRequest,
	row evidenceRelationshipRow,
) EvidenceInspectRecord {
	record := EvidenceInspectRecord{
		Ref:          evidenceInspectRef(row),
		Source:       publicEvidenceSubject(row.sourceKind, row.sourceID),
		Conclusion:   row.conclusion.String,
		ObservedAt:   row.observedAt.String,
		Supersedes:   append([]EvidenceInspectRef{}, row.supersedes...),
		Producer:     executionEvidenceSubject(row.producerID),
		PayloadState: row.payloadState,
	}
	if row.payloadUnavailableReason.Valid {
		record.PayloadUnavailableReason = row.payloadUnavailableReason.String
	}
	if request.IncludeData && row.payloadState == "available" &&
		row.payload.Valid {
		record.Data = []byte(row.payload.String)
	}
	if row.terminalKind.Valid && row.terminalID.Valid {
		record.AcceptedAfterTerminal = &EvidenceAcceptedAfterTerminal{
			JudgedAgainst: EvidenceTerminalExecution{
				Kind: row.terminalKind.String,
				ID:   row.terminalID.String,
			},
		}
	}
	return record
}

func evidenceInspectRef(row evidenceRelationshipRow) EvidenceInspectRef {
	return EvidenceInspectRef{
		Kind:         "execution.evidence",
		ID:           row.id,
		Subject:      publicEvidenceSubject(row.subjectKind, row.subjectID),
		Role:         row.role,
		EvidenceKind: row.evidenceKind,
		RecordedAt:   row.recordedAt,
	}
}

func publicEvidenceSubject(kind string, id string) EvidenceInspectSubject {
	if kind == "run" || kind == "span" {
		return EvidenceInspectSubject{Kind: "execution", ID: id}
	}
	return EvidenceInspectSubject{Kind: kind, ID: id}
}

func executionEvidenceSubject(id string) *EvidenceInspectSubject {
	return &EvidenceInspectSubject{Kind: "execution", ID: id}
}
