package observability

import (
	"path/filepath"
	"testing"
)

func TestEvidenceCoverageProjectionSurvivesRestartAndEventPagination(
	t *testing.T,
) {
	t.Setenv("CRUX_OBSERVABILITY_RETENTION_DAYS", "36500")
	path := filepath.Join(t.TempDir(), "observability.sqlite")
	first, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	for index, status := range []string{
		"not-configured",
		"not-configured",
		"redacted",
	} {
		if disposition := evidenceDisposition(
			t,
			first,
			evidenceCoverageProjectionRecord(t, index+1, status),
		); disposition.Outcome != "accepted" {
			t.Fatalf("coverage = %#v", disposition)
		}
	}
	events, err := first.SpanEvents(
		t.Context(),
		"run_coverage_projection",
		"1111111111111111",
		SpanEventListOptions{Limit: 1},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("bounded events = %d", len(events))
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenService(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	result, err := reopened.InspectEvidence(
		t.Context(),
		EvidenceInspectRequest{
			Subject: EvidenceInspectSubject{
				Kind: "execution",
				ID:   "2222222222222222",
			},
			Role:  "verification",
			Limit: 50,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.Roles.Verification.Coverage != "redacted" {
		t.Fatalf("coverage = %#v", result.Roles.Verification)
	}
	var statuses, supports int
	if err := reopened.db.QueryRow(`
		SELECT count(*), sum(support_count)
		FROM evidence_coverage_projection
		WHERE subject_kind = 'span'
		  AND subject_id = '2222222222222222'
		  AND role = 'verification'
	`).Scan(&statuses, &supports); err != nil {
		t.Fatal(err)
	}
	if statuses != 2 || supports != 3 {
		t.Fatalf("coverage = %d statuses/%d supports", statuses, supports)
	}
}
