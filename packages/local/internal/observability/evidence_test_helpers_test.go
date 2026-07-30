package observability

import (
	"encoding/json"
	"fmt"
	"testing"
)

type evidenceEdgeFixture struct {
	recordID           string
	edgeID             string
	evidenceID         string
	source             NodeRef
	subject            NodeRef
	producer           evidenceProducer
	role               string
	evidenceKind       string
	conclusion         string
	observedAt         string
	recordedAt         string
	captureState       string
	sourceMode         string
	digest             string
	idempotencyKeyHash string
	supersedes         []string
	segmentSeq         int
	runID              string
	operationID        string
	segmentID          string
	nonIdempotent      bool
}

func defaultEvidenceEdgeFixture(t *testing.T) evidenceEdgeFixture {
	t.Helper()
	fixture := evidenceEdgeFixture{
		recordID:           "rec_evidence_reservation",
		edgeID:             "edge_evidence_reservation",
		evidenceID:         "evidence_1111111111111111",
		source:             NodeRef{Kind: "artifact", ID: "artifact_evidence_source"},
		subject:            NodeRef{Kind: "span", ID: "2222222222222222"},
		producer:           evidenceProducer{Kind: "span", ID: "3333333333333333"},
		role:               "verification",
		evidenceKind:       "score.report",
		conclusion:         "passed",
		observedAt:         "2026-07-29T10:59:59Z",
		recordedAt:         "2026-07-29T11:00:00Z",
		captureState:       "reference",
		sourceMode:         "reference",
		idempotencyKeyHash: fmt.Sprintf("%064x", 1),
		supersedes: []string{
			"evidence_5555555555555555",
			"evidence_4444444444444444",
		},
		segmentSeq:  1,
		runID:       "run_evidence_reservation",
		operationID: "run_evidence_reservation",
		segmentID:   "seg_evidence_reservation",
	}
	fixture.digest = evidenceFixtureDigest(t, fixture)
	return fixture
}

func evidenceFixtureDigest(t *testing.T, fixture evidenceEdgeFixture) string {
	t.Helper()
	source := evidenceReferenceDigestSource(fixture.source)
	if fixture.sourceMode == "inline" {
		var err error
		source, err = evidenceInlineDigestSource(
			fixture.captureState,
			nil,
			nil,
			nil,
		)
		if err != nil {
			t.Fatal(err)
		}
	}
	digest, err := evidenceContentDigestV1(evidenceContentDigestInputV1{
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
	return digest
}

func evidenceFixtureDigestWithPreview(
	t *testing.T,
	fixture evidenceEdgeFixture,
	preview string,
) string {
	t.Helper()
	source, err := evidenceInlineDigestSource(
		fixture.captureState,
		json.RawMessage(preview),
		nil,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	digest, err := evidenceContentDigestV1(evidenceContentDigestInputV1{
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
	return digest
}

func insertEvidenceArtifact(
	t *testing.T,
	service *Service,
	fixture evidenceEdgeFixture,
	preview string,
) {
	t.Helper()
	if _, err := service.db.Exec(`
		INSERT INTO artifacts (
			artifact_id, run_id, kind, created_at, content_type, encoding,
			preview_json, attributes_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, fixture.source.ID, "run_evidence_reservation", fixture.evidenceKind,
		fixture.recordedAt, "application/json", "json", preview,
		`{"evidenceSource":{"evidenceId":"`+fixture.evidenceID+
			`","captureState":"available"}}`); err != nil {
		t.Fatal(err)
	}
}

func evidenceEdgeTestRecord(t *testing.T, fixture evidenceEdgeFixture) Record {
	t.Helper()
	attributes := map[string]any{
		"evidenceId":            fixture.evidenceID,
		"role":                  fixture.role,
		"evidenceKind":          fixture.evidenceKind,
		"observedAt":            fixture.observedAt,
		"recordedAt":            fixture.recordedAt,
		"producer":              fixture.producer,
		"supersedesEvidenceIds": fixture.supersedes,
		"captureState":          fixture.captureState,
		"sourceMode":            fixture.sourceMode,
	}
	if fixture.conclusion != "" {
		attributes["conclusion"] = fixture.conclusion
	}
	if !fixture.nonIdempotent {
		attributes["idempotencyKeyHash"] = fixture.idempotencyKeyHash
		attributes["contentDigestVersion"] = 1
		attributes["contentDigest"] = fixture.digest
	}
	payload, err := json.Marshal(map[string]any{
		"schemaVersion": 5,
		"recordId":      fixture.recordID,
		"type":          "edge",
		"operationId":   fixture.operationID,
		"runId":         fixture.runID,
		"segmentId":     fixture.segmentID,
		"segmentSeq":    fixture.segmentSeq,
		"edgeId":        fixture.edgeID,
		"edgeType":      "evidence.for",
		"from":          fixture.source,
		"to":            fixture.subject,
		"createdAt":     fixture.recordedAt,
		"attributes":    attributes,
	})
	if err != nil {
		t.Fatal(err)
	}
	return mustRecord(t, string(payload))
}

func evidenceDisposition(
	t *testing.T,
	service *Service,
	record Record,
) IngestDisposition {
	t.Helper()
	dispositions := service.IngestWithDispositions(
		t.Context(),
		Batch{SchemaVersion: SchemaVersion, Records: []Record{record}},
	)
	if len(dispositions) != 1 {
		t.Fatalf("dispositions = %#v", dispositions)
	}
	return dispositions[0]
}
