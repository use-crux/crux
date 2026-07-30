package observability

import (
	"fmt"
	"testing"
)

func TestEvidenceReservationPersistsDigestVerificationState(t *testing.T) {
	for name, setup := range map[string]struct {
		mutate func(*evidenceEdgeFixture)
		want   string
	}{
		"reference is immediately verified": {
			mutate: func(_ *evidenceEdgeFixture) {},
			want:   "verified",
		},
		"inline not-captured is immediately verified": {
			mutate: func(fixture *evidenceEdgeFixture) {
				fixture.sourceMode = "inline"
				fixture.captureState = "not-captured"
				fixture.digest = evidenceFixtureDigest(t, *fixture)
			},
			want: "verified",
		},
		"inline available waits for artifact": {
			mutate: func(fixture *evidenceEdgeFixture) {
				fixture.sourceMode = "inline"
				fixture.captureState = "available"
				fixture.digest = evidenceFixtureDigest(t, *fixture)
			},
			want: "pending",
		},
		"non-idempotent needs no verification": {
			mutate: func(fixture *evidenceEdgeFixture) {
				fixture.nonIdempotent = true
			},
			want: "not-required",
		},
	} {
		t.Run(name, func(t *testing.T) {
			service := newTestService(t)
			fixture := defaultEvidenceEdgeFixture(t)
			setup.mutate(&fixture)
			if disposition := evidenceDisposition(
				t,
				service,
				evidenceEdgeTestRecord(t, fixture),
			); disposition.Outcome != "accepted" {
				t.Fatalf("disposition = %#v", disposition)
			}
			var state string
			if err := service.db.QueryRow(`
				SELECT digest_verification_state
				FROM evidence_reservations WHERE evidence_id = ?
			`, fixture.evidenceID).Scan(&state); err != nil {
				t.Fatal(err)
			}
			if state != setup.want {
				t.Fatalf("verification state = %q, want %q", state, setup.want)
			}
		})
	}
}

func TestEvidenceCandidatePreservesExplicitZeroSize(t *testing.T) {
	service := newTestService(t)
	fixture := defaultEvidenceEdgeFixture(t)
	fixture.sourceMode = "inline"
	fixture.captureState = "reference"
	hash := "sha256:" +
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	size := int64(0)
	source, err := evidenceInlineDigestSource(
		"reference",
		nil,
		&hash,
		&size,
	)
	if err != nil {
		t.Fatal(err)
	}
	fixture.digest, err = evidenceContentDigestV1(evidenceContentDigestInputV1{
		Subject:               fixture.subject,
		Role:                  fixture.role,
		EvidenceKind:          fixture.evidenceKind,
		SourceMode:            fixture.sourceMode,
		Conclusion:            fixture.conclusion,
		ObservedAt:            fixture.observedAt,
		SupersedesEvidenceIDs: fixture.supersedes,
		Source:                source,
	})
	if err != nil {
		t.Fatal(err)
	}
	artifact := mustRecord(t, fmt.Sprintf(`{
		"schemaVersion":5,
		"recordId":"rec_zero_size_evidence",
		"type":"artifact",
		"operationId":"run_evidence_reservation",
		"runId":"run_evidence_reservation",
		"segmentId":"seg_evidence_reservation",
		"segmentSeq":1,
		"artifactId":"%s",
		"kind":"%s",
		"createdAt":"%s",
		"contentType":"application/json",
		"encoding":"reference",
		"sizeBytes":0,
		"hash":"%s",
		"attributes":{"evidenceSource":{
			"evidenceId":"%s",
			"captureState":"reference"
		}}
	}`, fixture.source.ID, fixture.evidenceKind, fixture.recordedAt, hash,
		fixture.evidenceID))
	fixture.segmentSeq = 2
	edge := evidenceEdgeTestRecord(t, fixture)

	dispositions := service.IngestWithDispositions(
		t.Context(),
		Batch{
			SchemaVersion: SchemaVersion,
			Records:       []Record{artifact, edge},
		},
	)
	for _, disposition := range dispositions {
		if disposition.Outcome != "accepted" {
			t.Fatalf("dispositions = %#v", dispositions)
		}
	}
}
