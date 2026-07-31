package observability

import (
	"fmt"
	"testing"
)

func TestEvidenceNonIdempotentInlineCandidateUsesNotRequiredVerification(t *testing.T) {
	service := newTestService(t)
	fixture, artifact, _ := availableEvidencePair(t, `{"approved":true}`)
	fixture.nonIdempotent = true
	edge := evidenceEdgeTestRecord(t, fixture)
	dispositions := service.IngestWithDispositions(
		t.Context(),
		Batch{SchemaVersion: SchemaVersion, Records: []Record{artifact, edge}},
	)
	for _, disposition := range dispositions {
		if disposition.Outcome != "accepted" {
			t.Fatalf("dispositions = %#v", dispositions)
		}
	}
	assertHydratedEvidence(t, service, fixture.evidenceID, "not-required")
}

func TestEvidenceReferenceCandidatePreservesOptionalMetadataPresence(t *testing.T) {
	for name, metadata := range map[string]string{
		"absent": "",
		"zero": `"hash":"sha256:` +
			`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` +
			`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sizeBytes":0,`,
	} {
		t.Run(name, func(t *testing.T) {
			service := newTestService(t)
			fixture := defaultEvidenceEdgeFixture(t)
			fixture.sourceMode = "inline"
			fixture.captureState = "reference"
			fixture.segmentSeq = 2
			var hash *string
			var size *int64
			if name == "zero" {
				value := "sha256:" +
					"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
					"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
				zero := int64(0)
				hash = &value
				size = &zero
			}
			source, err := evidenceInlineDigestSource(
				"reference",
				nil,
				hash,
				size,
			)
			if err != nil {
				t.Fatal(err)
			}
			fixture.digest, err = evidenceContentDigestV1(
				evidenceContentDigestInputV1{
					Subject:               fixture.subject,
					Role:                  fixture.role,
					EvidenceKind:          fixture.evidenceKind,
					SourceMode:            "inline",
					Conclusion:            fixture.conclusion,
					ObservedAt:            fixture.observedAt,
					SupersedesEvidenceIDs: fixture.supersedes,
					Source:                source,
				},
			)
			if err != nil {
				t.Fatal(err)
			}
			artifact := referenceEvidenceArtifactRecord(
				t,
				fixture,
				metadata,
				"reference",
			)
			dispositions := service.IngestWithDispositions(
				t.Context(),
				Batch{
					SchemaVersion: SchemaVersion,
					Records: []Record{
						artifact,
						evidenceEdgeTestRecord(t, fixture),
					},
				},
			)
			for _, disposition := range dispositions {
				if disposition.Outcome != "accepted" {
					t.Fatalf("dispositions = %#v", dispositions)
				}
			}
			assertEvidenceState(
				t,
				service,
				fixture.evidenceID,
				"reference",
				"verified",
			)
		})
	}
}

func TestEvidenceNonIdempotentAmbiguityIsOrderIndependent(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		name := "forward"
		if reverse {
			name = "reverse"
		}
		t.Run(name, func(t *testing.T) {
			service := newTestService(t)
			fixture, first, _ := availableEvidencePair(
				t,
				`{"approved":true}`,
			)
			fixture.nonIdempotent = true
			second := mutateEvidenceArtifactPreview(
				t,
				first,
				map[string]any{"approved": false},
			)
			second = mutateEvidenceArtifactRecordID(
				t,
				second,
				"rec_evidence_ambiguous_second",
			)
			second = mutateRecordSegmentSequence(t, second, 3)
			candidates := []Record{first, second}
			if reverse {
				candidates[0], candidates[1] = candidates[1], candidates[0]
			}
			for _, candidate := range candidates {
				if disposition := evidenceDisposition(
					t,
					service,
					candidate,
				); disposition.Outcome != "accepted" {
					t.Fatalf("candidate disposition = %#v", disposition)
				}
			}

			edge := evidenceEdgeTestRecord(t, fixture)
			if disposition := evidenceDisposition(
				t,
				service,
				edge,
			); disposition.Outcome != "accepted" {
				t.Fatalf("edge disposition = %#v", disposition)
			}
			assertEvidenceState(
				t,
				service,
				fixture.evidenceID,
				"reference",
				"not-required",
			)
			assertEvidenceTableCount(
				t,
				service,
				"evidence_staging_candidates",
				0,
			)
			assertEvidenceTableCount(t, service, "artifacts", 0)
			assertEvidenceHealthCount(
				t,
				service,
				evidenceStagingUnpromotableCode,
				2,
			)

			if disposition := evidenceDisposition(
				t,
				service,
				first,
			); disposition.Outcome != "accepted" {
				t.Fatalf("direct hydration = %#v", disposition)
			}
			assertHydratedEvidence(
				t,
				service,
				fixture.evidenceID,
				"not-required",
			)
			if disposition := evidenceDisposition(
				t,
				service,
				first,
			); disposition.Outcome != "accepted" {
				t.Fatalf("exact replay = %#v", disposition)
			}
			if disposition := evidenceDisposition(
				t,
				service,
				second,
			); disposition.Code != evidenceIdempotencyConflictCode {
				t.Fatalf("divergent replay = %#v", disposition)
			}
			assertHydratedEvidence(
				t,
				service,
				fixture.evidenceID,
				"not-required",
			)
		})
	}
}

func TestEvidenceNotCapturedCandidateRetainsItsState(t *testing.T) {
	service := newTestService(t)
	fixture := defaultEvidenceEdgeFixture(t)
	fixture.sourceMode = "inline"
	fixture.captureState = "not-captured"
	fixture.segmentSeq = 2
	fixture.digest = evidenceFixtureDigest(t, fixture)
	artifact := referenceEvidenceArtifactRecord(
		t,
		fixture,
		"",
		"not-captured",
	)
	dispositions := service.IngestWithDispositions(
		t.Context(),
		Batch{
			SchemaVersion: SchemaVersion,
			Records: []Record{
				artifact,
				evidenceEdgeTestRecord(t, fixture),
			},
		},
	)
	for _, disposition := range dispositions {
		if disposition.Outcome != "accepted" {
			t.Fatalf("dispositions = %#v", dispositions)
		}
	}
	assertEvidenceState(
		t,
		service,
		fixture.evidenceID,
		"not-captured",
		"verified",
	)
}

func referenceEvidenceArtifactRecord(
	t *testing.T,
	fixture evidenceEdgeFixture,
	metadata string,
	captureState string,
) Record {
	t.Helper()
	return mustRecord(t, fmt.Sprintf(`{
		"schemaVersion":5,
		"recordId":"rec_evidence_reference_artifact",
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
		%s
		"attributes":{"evidenceSource":{
			"evidenceId":"%s",
			"captureState":"%s"
		}}
	}`, fixture.source.ID, fixture.evidenceKind, fixture.recordedAt, metadata,
		fixture.evidenceID, captureState))
}

func assertEvidenceState(
	t *testing.T,
	service *Service,
	evidenceID string,
	wantPayload string,
	wantVerification string,
) {
	t.Helper()
	var payload, verification string
	if err := service.db.QueryRow(`
		SELECT relationships.payload_state, reservations.digest_verification_state
		FROM evidence_relationships relationships
		JOIN evidence_reservations reservations
		  USING (authorization_namespace, evidence_id)
		WHERE relationships.evidence_id = ?
	`, evidenceID).Scan(&payload, &verification); err != nil {
		t.Fatal(err)
	}
	if payload != wantPayload || verification != wantVerification {
		t.Fatalf("evidence state = %q/%q", payload, verification)
	}
}
