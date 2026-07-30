package observability

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

const evidenceRetentionSentinel = "EVIDENCE-PAYLOAD-RETENTION-SENTINEL"

func TestEvidencePayloadRetentionStartsAtHydrationForBothDeliveryOrders(
	t *testing.T,
) {
	for _, artifactFirst := range []bool{true, false} {
		name := "edge-first"
		if artifactFirst {
			name = "artifact-first"
		}
		t.Run(name, func(t *testing.T) {
			now := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
			service := newEvidenceRetentionTestService(
				t,
				func() time.Time { return now },
			)
			fixture, artifact, edge := availableEvidencePair(
				t,
				`{"marker":"`+evidenceRetentionSentinel+`"}`,
			)
			first, second := edge, artifact
			if artifactFirst {
				first, second = artifact, edge
			}
			if disposition := evidenceDisposition(
				t,
				service,
				first,
			); disposition.Outcome != "accepted" {
				t.Fatalf("first disposition = %#v", disposition)
			}

			now = now.Add(30 * time.Minute)
			if disposition := evidenceDisposition(
				t,
				service,
				second,
			); disposition.Outcome != "accepted" {
				t.Fatalf("second disposition = %#v", disposition)
			}
			assertEvidencePayloadTimes(
				t,
				service,
				fixture.evidenceID,
				now,
			)
			beforeRevision, err := service.CurrentRevision(t.Context())
			if err != nil {
				t.Fatal(err)
			}

			now = now.Add(45 * time.Minute)
			runEvidenceRetentionForTest(t, service, now)
			assertEvidencePayloadState(
				t,
				service,
				fixture.evidenceID,
				"available",
				"",
			)

			now = now.Add(16 * time.Minute)
			runEvidenceRetentionForTest(t, service, now)
			assertEvidencePayloadState(
				t,
				service,
				fixture.evidenceID,
				"redacted",
				"retention",
			)
			assertExpiredPayloadIsUnavailable(
				t,
				service,
				fixture,
				evidenceRetentionSentinel,
			)
			afterRevision, err := service.CurrentRevision(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			if afterRevision <= beforeRevision {
				t.Fatalf(
					"payload compaction revision = %d, want > %d",
					afterRevision,
					beforeRevision,
				)
			}
		})
	}
}

func TestExpiredEvidencePayloadRetryDoesNotRestoreCompactedData(
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
			t.Fatalf("initial disposition = %#v", disposition)
		}
	}
	now = now.Add(time.Hour + time.Minute)
	runEvidenceRetentionForTest(t, service, now)

	if disposition := evidenceDisposition(
		t,
		service,
		artifact,
	); disposition.Outcome != "accepted" {
		t.Fatalf("exact compacted retry = %#v", disposition)
	}
	assertEvidencePayloadState(
		t,
		service,
		fixture.evidenceID,
		"redacted",
		"retention",
	)
	assertExpiredPayloadIsUnavailable(
		t,
		service,
		fixture,
		evidenceRetentionSentinel,
	)

	divergent := evidenceInlineArtifactRecord(
		t,
		fixture,
		`{"marker":"DIFFERENT-EVIDENCE-PAYLOAD"}`,
	)
	if disposition := evidenceDisposition(
		t,
		service,
		divergent,
	); disposition.Code != evidenceIdempotencyConflictCode ||
		disposition.Retryable {
		t.Fatalf("divergent compacted retry = %#v", disposition)
	}
}

func newEvidenceRetentionTestService(
	t *testing.T,
	now func() time.Time,
) *Service {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	service, err := newServiceWithOptions(
		context.Background(),
		db,
		inMemoryMaxOpenConns,
		serviceOptions{
			evidenceNow: now,
			evidenceSettings: &evidenceSettings{
				RelationshipRetention: 3 * time.Hour,
				PayloadRetention:      time.Hour,
				StagingTTL:            time.Hour,
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func runEvidenceRetentionForTest(
	t *testing.T,
	service *Service,
	now time.Time,
) {
	t.Helper()
	if _, err := service.runRetention(
		t.Context(),
		service.retentionSettings,
		now,
	); err != nil {
		t.Fatal(err)
	}
}

func assertEvidencePayloadTimes(
	t *testing.T,
	service *Service,
	evidenceID string,
	wantPayload time.Time,
) {
	t.Helper()
	var relationshipAcceptedAt, payloadAcceptedAt string
	if err := service.db.QueryRow(`
		SELECT relationship_accepted_at, payload_accepted_at
		FROM evidence_relationships
		WHERE evidence_id = ?
	`, evidenceID).Scan(
		&relationshipAcceptedAt,
		&payloadAcceptedAt,
	); err != nil {
		t.Fatal(err)
	}
	if payloadAcceptedAt != formatEvidenceAcceptanceTime(wantPayload) {
		t.Fatalf(
			"payload accepted at %q, want %q",
			payloadAcceptedAt,
			formatEvidenceAcceptanceTime(wantPayload),
		)
	}
	if relationshipAcceptedAt == "" {
		t.Fatal("relationship acceptance clock is missing")
	}
}

func assertEvidencePayloadState(
	t *testing.T,
	service *Service,
	evidenceID string,
	wantState string,
	wantReason string,
) {
	t.Helper()
	var state string
	var reason sql.NullString
	if err := service.db.QueryRow(`
		SELECT payload_state, payload_unavailable_reason
		FROM evidence_relationships
		WHERE evidence_id = ?
	`, evidenceID).Scan(&state, &reason); err != nil {
		t.Fatal(err)
	}
	if state != wantState || reason.String != wantReason {
		t.Fatalf(
			"payload state = %q/%q, want %q/%q",
			state,
			reason.String,
			wantState,
			wantReason,
		)
	}
}

func assertExpiredPayloadIsUnavailable(
	t *testing.T,
	service *Service,
	fixture evidenceEdgeFixture,
	sentinel string,
) {
	t.Helper()
	var preview sql.NullString
	if err := service.db.QueryRow(`
		SELECT preview_json FROM artifacts WHERE artifact_id = ?
	`, fixture.source.ID).Scan(&preview); err != nil {
		t.Fatal(err)
	}
	if preview.Valid {
		t.Fatalf("artifact preview remains after payload expiry: %s", preview.String)
	}
	result, err := service.InspectEvidence(t.Context(), EvidenceInspectRequest{
		Subject: EvidenceInspectSubject{
			Kind: "execution",
			ID:   fixture.subject.ID,
		},
		Role:        fixture.role,
		Limit:       50,
		IncludeData: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	role := result.Roles.Verification
	if len(role.Records) != 1 ||
		role.Status != "redacted" ||
		role.Records[0].PayloadState != "redacted" ||
		role.Records[0].PayloadUnavailableReason != "retention" ||
		len(role.Records[0].Data) != 0 {
		t.Fatalf("expired inspection = %#v", role)
	}
	assertNoLogicalStorageContains(t, service.db, sentinel)
}
