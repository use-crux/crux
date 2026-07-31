package observability

import (
	"testing"
	"time"
)

func TestEvidenceRelationshipRetentionRemovesIdentityAndLeavesRunVisible(
	t *testing.T,
) {
	now := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
	service := newEvidenceRetentionTestService(t, func() time.Time {
		return now
	})
	fixture, artifact, edge := availableEvidencePair(
		t,
		`{"approved":true}`,
	)
	for _, record := range []Record{edge, artifact} {
		if disposition := evidenceDisposition(
			t,
			service,
			record,
		); disposition.Outcome != "accepted" {
			t.Fatalf("initial disposition = %#v", disposition)
		}
	}

	now = now.Add(3*time.Hour + time.Minute)
	runEvidenceRetentionForTest(t, service, now)

	for table, query := range map[string]string{
		"evidence relationships": `
			SELECT count(*) FROM evidence_relationships
			WHERE evidence_id = ?`,
		"evidence reservations": `
			SELECT count(*) FROM evidence_reservations
			WHERE evidence_id = ?`,
		"evidence payload records": `
			SELECT count(*) FROM evidence_payload_records
			WHERE evidence_id = ?`,
		"evidence staging": `
			SELECT count(*) FROM evidence_staging_candidates
			WHERE evidence_id = ?`,
	} {
		assertEvidenceQueryCount(
			t,
			service,
			table,
			query,
			fixture.evidenceID,
			0,
		)
	}
	assertEvidenceQueryCount(
		t,
		service,
		"canonical edge",
		`SELECT count(*) FROM edges WHERE edge_id = ?`,
		fixture.edgeID,
		0,
	)
	assertEvidenceQueryCount(
		t,
		service,
		"evidence edge raw record",
		`SELECT count(*) FROM records WHERE record_id = ?`,
		fixture.recordID,
		0,
	)
	assertEvidenceQueryCount(
		t,
		service,
		"evidence artifact",
		`SELECT count(*) FROM artifacts WHERE artifact_id = ?`,
		fixture.source.ID,
		0,
	)
	assertEvidenceQueryCount(
		t,
		service,
		"evidence artifact raw record",
		`SELECT count(*) FROM records WHERE record_id = ?`,
		"rec_evidence_inline_artifact",
		0,
	)
	assertEvidenceQueryCount(
		t,
		service,
		"producing run",
		`SELECT count(*) FROM runs WHERE run_id = ?`,
		fixture.runID,
		1,
	)
	var recordCount, artifactCount, edgeCount int
	if err := service.db.QueryRow(`
		SELECT record_count, artifact_count, edge_count
		FROM runs WHERE run_id = ?
	`, fixture.runID).Scan(
		&recordCount,
		&artifactCount,
		&edgeCount,
	); err != nil {
		t.Fatal(err)
	}
	if recordCount != 0 || artifactCount != 0 || edgeCount != 0 {
		t.Fatalf(
			"retained run rollups = %d records/%d artifacts/%d edges",
			recordCount,
			artifactCount,
			edgeCount,
		)
	}
	var watermarks int
	if err := service.db.QueryRow(`
		SELECT count(*) FROM evidence_truncation_watermarks
		WHERE subject_kind = ? AND subject_id = ? AND role = ?
	`, fixture.subject.Kind, fixture.subject.ID, fixture.role).Scan(
		&watermarks,
	); err != nil {
		t.Fatal(err)
	}
	if watermarks != 1 {
		t.Fatalf("truncation watermark count = %d, want 1", watermarks)
	}

	for _, record := range []Record{edge, artifact} {
		if disposition := evidenceDisposition(
			t,
			service,
			record,
		); disposition.Outcome != "accepted" {
			t.Fatalf("new retention epoch disposition = %#v", disposition)
		}
	}
	assertEvidenceQueryCount(
		t,
		service,
		"new evidence relationship",
		`SELECT count(*) FROM evidence_relationships WHERE evidence_id = ?`,
		fixture.evidenceID,
		1,
	)
}

func TestEvidenceRelationshipExpiryOmitsMissingSupersessionHistory(
	t *testing.T,
) {
	now := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
	service := newEvidenceRetentionTestService(t, func() time.Time {
		return now
	})
	predecessor := evidenceRelationshipFixture(
		t,
		"aaaaaaaaaaaaaaaa",
		"verification",
		"failed",
		1,
	)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, predecessor),
	); disposition.Outcome != "accepted" {
		t.Fatalf("predecessor = %#v", disposition)
	}
	now = now.Add(2 * time.Hour)
	successor := evidenceRelationshipFixture(
		t,
		"bbbbbbbbbbbbbbbb",
		"verification",
		"passed",
		2,
	)
	successor.supersedes = []string{predecessor.evidenceID}
	successor.digest = evidenceFixtureDigest(t, successor)
	if disposition := evidenceDisposition(
		t,
		service,
		evidenceEdgeTestRecord(t, successor),
	); disposition.Outcome != "accepted" {
		t.Fatalf("successor = %#v", disposition)
	}

	now = now.Add(90 * time.Minute)
	runEvidenceRetentionForTest(t, service, now)
	result, err := service.InspectEvidence(
		t.Context(),
		EvidenceInspectRequest{
			Subject: EvidenceInspectSubject{
				Kind: "execution",
				ID:   successor.subject.ID,
			},
			Role:           "verification",
			Limit:          50,
			IncludeHistory: true,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	role := result.Roles.Verification
	if len(role.Records) != 1 ||
		role.Records[0].Ref.ID != successor.evidenceID ||
		len(role.Records[0].Supersedes) != 0 ||
		len(role.History) != 0 ||
		role.Conclusion != "passed" ||
		!role.Truncated {
		t.Fatalf("truncated successor = %#v", role)
	}
}

func TestEvidenceRelationshipExpiryPreservesReferencedArtifactShellOnly(
	t *testing.T,
) {
	now := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
	service := newEvidenceRetentionTestService(t, func() time.Time {
		return now
	})
	fixture, artifact, edge := availableEvidencePair(
		t,
		`{"marker":"`+evidenceRetentionSentinel+`"}`,
	)
	for _, record := range []Record{edge, artifact} {
		if disposition := evidenceDisposition(
			t,
			service,
			record,
		); disposition.Outcome != "accepted" {
			t.Fatalf("evidence record = %#v", disposition)
		}
	}
	reference := mustRecord(t, `{
		"schemaVersion":5,
		"recordId":"rec_artifact_shell_reference",
		"type":"edge",
		"operationId":"run_evidence_reservation",
		"runId":"run_evidence_reservation",
		"segmentId":"seg_evidence_reservation",
		"segmentSeq":3,
		"edgeId":"edge_artifact_shell_reference",
		"edgeType":"derived.from",
		"from":{"kind":"artifact","id":"artifact_evidence_source"},
		"to":{"kind":"span","id":"2222222222222222"},
		"createdAt":"2026-07-29T11:00:01Z"
	}`)
	if disposition := evidenceDisposition(
		t,
		service,
		reference,
	); disposition.Outcome != "accepted" {
		t.Fatalf("reference edge = %#v", disposition)
	}

	now = now.Add(3*time.Hour + time.Minute)
	if err := service.cleanupExpiredEvidenceRelationships(
		t.Context(),
		now,
	); err != nil {
		t.Fatal(err)
	}
	assertEvidenceQueryCount(
		t,
		service,
		"referenced artifact shell",
		`SELECT count(*) FROM artifacts WHERE artifact_id = ?`,
		fixture.source.ID,
		1,
	)
	var preview any
	if err := service.db.QueryRow(`
		SELECT preview_json FROM artifacts WHERE artifact_id = ?
	`, fixture.source.ID).Scan(&preview); err != nil {
		t.Fatal(err)
	}
	if preview != nil {
		t.Fatalf("referenced artifact preview = %#v", preview)
	}
	assertNoLogicalStorageContains(
		t,
		service.db,
		evidenceRetentionSentinel,
	)
}

func assertEvidenceQueryCount(
	t *testing.T,
	service *Service,
	label string,
	query string,
	arg1 any,
	want int,
) {
	t.Helper()
	var count int
	if err := service.db.QueryRow(query, arg1).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != want {
		t.Fatalf("%s count = %d, want %d", label, count, want)
	}
}
