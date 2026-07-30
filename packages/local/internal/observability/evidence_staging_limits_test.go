package observability

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestEvidenceCandidateEnforcesNamespaceAndProjectQuotas(t *testing.T) {
	for _, testCase := range []struct {
		name          string
		namespace     string
		rows          int
		retainedBytes int
	}{
		{
			name:          "namespace retained bytes",
			namespace:     localEvidenceAuthorizationNamespace,
			rows:          1,
			retainedBytes: evidenceCandidateBytesPerNamespace - 1,
		},
		{
			name:      "namespace rows",
			namespace: localEvidenceAuthorizationNamespace,
			rows:      evidenceCandidatesPerNamespace,
		},
		{
			name:          "project retained bytes",
			namespace:     "other",
			rows:          1,
			retainedBytes: evidenceCandidateBytesPerProject - 1,
		},
		{
			name:      "project rows",
			namespace: "other",
			rows:      evidenceCandidatesPerProject,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			service := newEvidenceStagingTestService(t, time.Now)
			seedEvidenceStagingRows(
				t,
				service,
				testCase.namespace,
				testCase.rows,
				testCase.retainedBytes,
			)
			disposition := evidenceDisposition(
				t,
				service,
				evidenceSourceArtifactTestRecord(t),
			)
			if disposition.Code != evidenceStagingCapacityCode ||
				!disposition.Retryable {
				t.Fatalf("capacity disposition = %#v", disposition)
			}
		})
	}
}

func TestEvidenceCandidateEnforcesExactFixedSizeBoundary(t *testing.T) {
	service := newEvidenceStagingTestService(t, time.Now)
	base := evidenceSourceArtifactTestRecord(t)
	atLimit := mutateEvidenceArtifactPreview(
		t,
		base,
		map[string]any{
			"padding": strings.Repeat("x", 524152),
		},
	)
	if disposition := evidenceDisposition(t, service, atLimit); disposition.Outcome != "accepted" {
		t.Fatalf("at-limit disposition = %#v", disposition)
	}

	oversized := mutateEvidenceArtifactPreview(
		t,
		base,
		map[string]any{
			"padding": strings.Repeat("x", 524153),
		},
	)
	oversized = mutateEvidenceArtifactRecordID(
		t,
		oversized,
		"rec_evidence_oversized",
	)
	disposition := evidenceDisposition(t, service, oversized)
	if disposition.Code != evidenceStagingCandidateTooLargeCode ||
		disposition.Retryable {
		t.Fatalf("oversized disposition = %#v", disposition)
	}
	assertEvidenceTableCount(t, service, "evidence_staging_candidates", 1)
	assertEvidenceTableCount(t, service, "records", 0)
	assertEvidenceTableCount(t, service, "artifacts", 0)
}

func TestEvidenceCandidateConcurrentPerEvidenceCapacityIsAtomic(t *testing.T) {
	service := newEvidenceStagingTestService(t, time.Now)
	records := make([]Record, 8)
	for index := range records {
		record := mutateEvidenceArtifactPreview(
			t,
			evidenceSourceArtifactTestRecord(t),
			map[string]any{"candidate": index},
		)
		records[index] = mutateEvidenceArtifactRecordID(
			t,
			record,
			"rec_concurrent_candidate_"+string(rune('a'+index)),
		)
	}

	results := make(chan IngestDisposition, len(records))
	var group sync.WaitGroup
	for _, record := range records {
		group.Add(1)
		go func(candidate Record) {
			defer group.Done()
			dispositions := service.IngestWithDispositions(
				t.Context(),
				Batch{
					SchemaVersion: SchemaVersion,
					Records:       []Record{candidate},
				},
			)
			results <- dispositions[0]
		}(record)
	}
	group.Wait()
	close(results)

	accepted := 0
	capacity := 0
	for disposition := range results {
		switch {
		case disposition.Outcome == "accepted":
			accepted++
		case disposition.Code == evidenceStagingCapacityCode &&
			disposition.Retryable:
			capacity++
		default:
			t.Fatalf("unexpected disposition = %#v", disposition)
		}
	}
	if accepted != evidenceCandidatesPerEvidence ||
		capacity != len(records)-evidenceCandidatesPerEvidence {
		t.Fatalf("accepted/capacity = %d/%d", accepted, capacity)
	}
	assertEvidenceTableCount(
		t,
		service,
		"evidence_staging_candidates",
		evidenceCandidatesPerEvidence,
	)
	assertEvidenceHealthCount(
		t,
		service,
		evidenceStagingCapacityCode,
		len(records)-evidenceCandidatesPerEvidence,
	)
}

func seedEvidenceStagingRows(
	t *testing.T,
	service *Service,
	namespace string,
	rows int,
	retainedBytes int,
) {
	t.Helper()
	if retainedBytes == 0 {
		retainedBytes = 2
	}
	acceptedAt := time.Now().UTC()
	tx, err := service.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < rows; index++ {
		evidenceID := fmt.Sprintf("evidence_%016x", index+10_000)
		digest := fmt.Sprintf("sha256:%064x", index+10_000)
		if _, err := tx.Exec(`
			INSERT INTO evidence_staging_candidates (
				authorization_namespace, evidence_id, digest_version,
				candidate_digest, artifact_id, record_id, run_id, operation_id,
				trace_id, segment_id, segment_seq, capture_state,
				record_payload_json, candidate_bytes, retained_bytes,
				accepted_at, expires_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, '{}', ?, ?, ?, ?)
		`, namespace, evidenceID, evidenceCandidateDigestVersion, digest,
			"artifact_"+evidenceID, "record_"+evidenceID, "run_seed",
			"run_seed", "segment_"+evidenceID, index+1, "available", 2,
			retainedBytes, acceptedAt.Format(time.RFC3339Nano),
			acceptedAt.Add(24*time.Hour).Format(time.RFC3339Nano)); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}
