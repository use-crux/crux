package observability

import (
	"fmt"
	"testing"
)

func TestEvidenceInspectorProjectsFiveRolesAndOutOfOrderSupersession(
	t *testing.T,
) {
	service := newTestService(t)
	subjectID := "2222222222222222"
	predecessor := evidenceRelationshipFixture(
		t,
		"aaaaaaaaaaaaaaaa",
		"verification",
		"failed",
		2,
	)
	successor := evidenceRelationshipFixture(
		t,
		"bbbbbbbbbbbbbbbb",
		"verification",
		"passed",
		1,
	)
	successor.supersedes = []string{predecessor.evidenceID}
	successor.digest = evidenceFixtureDigest(t, successor)
	allowed := evidenceRelationshipFixture(
		t,
		"cccccccccccccccc",
		"authority",
		"allowed",
		3,
	)
	denied := evidenceRelationshipFixture(
		t,
		"dddddddddddddddd",
		"authority",
		"denied",
		4,
	)
	for _, fixture := range []evidenceEdgeFixture{
		successor,
		predecessor,
		allowed,
		denied,
	} {
		if disposition := evidenceDisposition(
			t,
			service,
			evidenceEdgeTestRecord(t, fixture),
		); disposition.Outcome != "accepted" {
			t.Fatalf("ingest %s = %#v", fixture.evidenceID, disposition)
		}
	}

	result, err := service.InspectEvidence(t.Context(), EvidenceInspectRequest{
		Subject: EvidenceInspectSubject{
			Kind: "execution",
			ID:   subjectID,
		},
		Role:           "verification",
		Limit:          50,
		IncludeHistory: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	if result.Subject.Kind != "execution" ||
		result.Subject.ID != subjectID {
		t.Fatalf("subject = %#v", result.Subject)
	}
	if result.Roles.Intent.Role != "intent" ||
		result.Roles.Recovery.Role != "recovery" {
		t.Fatalf("five role map = %#v", result.Roles)
	}
	verification := result.Roles.Verification
	if len(verification.Records) != 1 ||
		verification.ActiveRecordCount != 1 ||
		verification.Status != "present" ||
		verification.Records[0].Ref.ID != successor.evidenceID ||
		len(verification.Records[0].Supersedes) != 1 ||
		verification.Records[0].Supersedes[0].ID != predecessor.evidenceID ||
		verification.Conclusion != "passed" ||
		verification.Conflicting ||
		verification.Truncated {
		t.Fatalf("verification = %#v", verification)
	}
	if len(verification.History) != 1 ||
		verification.History[0].Ref.ID != predecessor.evidenceID {
		t.Fatalf("verification history = %#v", verification.History)
	}
	authority := result.Roles.Authority
	if len(authority.Records) != 0 ||
		authority.ActiveRecordCount != 2 ||
		authority.Status != "present" ||
		authority.Conclusion != "" ||
		!authority.Conflicting {
		t.Fatalf("authority summary = %#v", authority)
	}
}

func TestEvidenceInspectorUsesDurableNormalizedCoveragePrecedence(
	t *testing.T,
) {
	service := newTestService(t)
	for index, status := range []string{
		"not-configured",
		"not-configured",
		"redacted",
	} {
		record := evidenceCoverageProjectionRecord(
			t,
			index+1,
			status,
		)
		if disposition := evidenceDisposition(
			t,
			service,
			record,
		); disposition.Outcome != "accepted" {
			t.Fatalf("coverage disposition = %#v", disposition)
		}
	}

	result, err := service.InspectEvidence(t.Context(), EvidenceInspectRequest{
		Subject: EvidenceInspectSubject{
			Kind: "execution",
			ID:   "2222222222222222",
		},
		Role:  "verification",
		Limit: 50,
	})
	if err != nil {
		t.Fatal(err)
	}
	role := result.Roles.Verification
	if role.Status != "redacted" ||
		role.Coverage != role.Status ||
		len(role.Records) != 0 ||
		role.Conflicting {
		t.Fatalf("verification coverage = %#v", role)
	}
	var statuses, supports int
	if err := service.db.QueryRow(`
		SELECT count(*), sum(support_count)
		FROM evidence_coverage_projection
		WHERE subject_kind = 'span'
		  AND subject_id = '2222222222222222'
		  AND role = 'verification'
	`).Scan(&statuses, &supports); err != nil {
		t.Fatal(err)
	}
	if statuses != 2 || supports != 3 {
		t.Fatalf("coverage normalization = %d statuses/%d supports",
			statuses, supports)
	}
}

func TestEvidenceInspectorActiveEvidenceSuppressesNonPresentCoverage(
	t *testing.T,
) {
	service := newTestService(t)
	coverage := evidenceCoverageProjectionRecordForRole(
		t,
		1,
		"intent",
		"not-configured",
	)
	intent := evidenceRelationshipFixture(
		t, "9999999999999999", "intent", "", 2,
	)
	for _, record := range []Record{
		coverage,
		evidenceEdgeTestRecord(t, intent),
	} {
		if disposition := evidenceDisposition(
			t,
			service,
			record,
		); disposition.Outcome != "accepted" {
			t.Fatalf("disposition = %#v", disposition)
		}
	}

	result, err := service.InspectEvidence(t.Context(), EvidenceInspectRequest{
		Subject: EvidenceInspectSubject{
			Kind: "execution",
			ID:   intent.subject.ID,
		},
		Role:  "verification",
		Limit: 50,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Roles.Intent.Status != "present" ||
		result.Roles.Intent.Coverage != "" {
		t.Fatalf("active intent retained non-present coverage: %#v",
			result.Roles.Intent)
	}
}

func TestEvidenceInspectorOmitsMissingHistoryAndReportsTruncation(
	t *testing.T,
) {
	service := newTestService(t)
	fixture := evidenceRelationshipFixture(
		t, "8888888888888888", "verification", "passed", 1,
	)
	fixture.supersedes = []string{"evidence_7777777777777777"}
	fixture.digest = evidenceFixtureDigest(t, fixture)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, fixture),
	); disposition.Outcome != "accepted" {
		t.Fatalf("disposition = %#v", disposition)
	}

	result, err := service.InspectEvidence(t.Context(), EvidenceInspectRequest{
		Subject: EvidenceInspectSubject{
			Kind: "execution",
			ID:   fixture.subject.ID,
		},
		Role:           "verification",
		Limit:          50,
		IncludeHistory: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	role := result.Roles.Verification
	if !role.Truncated ||
		len(role.Records) != 1 ||
		len(role.Records[0].Supersedes) != 0 ||
		len(role.History) != 0 {
		t.Fatalf("missing history projection = %#v", role)
	}
}

func evidenceRelationshipFixture(
	t *testing.T,
	idSuffix string,
	role string,
	conclusion string,
	sequence int,
) evidenceEdgeFixture {
	t.Helper()
	fixture := defaultEvidenceEdgeFixture(t)
	fixture.evidenceID = "evidence_" + idSuffix
	fixture.recordID = "rec_inspector_" + idSuffix
	fixture.edgeID = "edge_inspector_" + idSuffix
	fixture.source.ID = "artifact_inspector_" + idSuffix
	fixture.role = role
	fixture.evidenceKind = "custom.inspector-review"
	fixture.conclusion = conclusion
	fixture.supersedes = nil
	fixture.segmentSeq = sequence
	fixture.digest = evidenceFixtureDigest(t, fixture)
	return fixture
}

func evidenceCoverageProjectionRecord(
	t *testing.T,
	index int,
	status string,
) Record {
	return evidenceCoverageProjectionRecordForRole(
		t,
		index,
		"verification",
		status,
	)
}

func evidenceCoverageProjectionRecordForRole(
	t *testing.T,
	index int,
	role string,
	status string,
) Record {
	t.Helper()
	return mustRecord(t, fmt.Sprintf(`{
		"schemaVersion":5,
		"recordId":"rec_coverage_projection_%d",
		"type":"span:event",
		"operationId":"run_coverage_projection",
		"runId":"run_coverage_projection",
		"segmentId":"seg_coverage_projection",
		"segmentSeq":%d,
		"spanId":"1111111111111111",
		"eventId":"event_coverage_projection_%d",
		"name":"evidence.coverage",
		"timestamp":"2026-07-29T12:00:00Z",
		"attributes":{
			"subject":{"kind":"span","id":"2222222222222222"},
			"role":%q,
			"status":%q
		}
	}`, index, index, index, role, status))
}
