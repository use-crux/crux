package devtools

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestEvidenceAdaptersUseTheCanonicalInspector(t *testing.T) {
	obs, err := observability.OpenService(t.Context(), ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = obs.Close() })
	var edge observability.Record
	if err := json.Unmarshal([]byte(`{
		"schemaVersion":5,
		"recordId":"rec_direct_evidence",
		"type":"edge",
		"operationId":"run_direct_evidence",
		"runId":"run_direct_evidence",
		"segmentId":"seg_direct_evidence",
		"segmentSeq":1,
		"edgeId":"edge_direct_evidence",
		"edgeType":"evidence.for",
		"from":{"kind":"artifact","id":"artifact_direct_evidence"},
		"to":{"kind":"span","id":"2222222222222222"},
		"createdAt":"2026-07-29T12:00:00Z",
		"attributes":{
			"evidenceId":"evidence_1111111111111111",
			"role":"verification",
			"evidenceKind":"score.report",
			"conclusion":"passed",
			"recordedAt":"2026-07-29T12:00:00Z",
			"producer":{"kind":"span","id":"3333333333333333"},
			"captureState":"reference",
			"sourceMode":"reference"
		}
	}`), &edge); err != nil {
		t.Fatal(err)
	}
	obs.IngestWithDispositions(t.Context(), observability.Batch{
		SchemaVersion: observability.SchemaVersion,
		Records:       []observability.Record{edge},
	})
	devtools := NewService(store.NewStore(), nil).WithObservability(obs)
	t.Cleanup(devtools.Shutdown)
	direct := NewDirectClientFromService(devtools).WithObservability(obs)
	request := observability.EvidenceInspectRequest{
		Subject: observability.EvidenceInspectSubject{
			Kind: "execution",
			ID:   "2222222222222222",
		},
		Role:  "verification",
		Limit: 50,
	}

	fromService, err := devtools.InspectEvidence(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	fromDirect, err := direct.InspectEvidence(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	fromCanonical, err := obs.InspectEvidence(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(fromService, fromCanonical) ||
		!reflect.DeepEqual(fromDirect, fromCanonical) {
		t.Fatalf("adapter divergence: service=%#v direct=%#v canonical=%#v",
			fromService, fromDirect, fromCanonical)
	}

	summaryRequest := observability.EvidenceSubjectSummaryRequest{
		Subjects: []observability.EvidenceInspectSubject{request.Subject},
	}
	summary, err := devtools.SummarizeEvidenceSubjects(
		t.Context(),
		summaryRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	directSummary, err := direct.SummarizeEvidenceSubjects(
		t.Context(),
		summaryRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	canonicalSummary, err := obs.SummarizeEvidenceSubjects(
		t.Context(),
		summaryRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(summary, canonicalSummary) ||
		!reflect.DeepEqual(directSummary, canonicalSummary) {
		t.Fatal("subject summary adapters diverged")
	}
}
