package observability

import (
	"testing"
	"time"
)

func TestEvidenceCoverageExpiryIsReferenceCountedAndMarksFinalTruncation(
	t *testing.T,
) {
	now := time.Date(2026, 7, 29, 11, 0, 0, 0, time.UTC)
	service := newEvidenceRetentionTestService(t, func() time.Time {
		return now
	})
	first := evidenceCoverageProjectionRecord(t, 1, "not-configured")
	if disposition := evidenceDisposition(
		t,
		service,
		first,
	); disposition.Outcome != "accepted" {
		t.Fatalf("first coverage = %#v", disposition)
	}
	now = now.Add(time.Hour)
	second := evidenceCoverageProjectionRecord(t, 2, "not-configured")
	if disposition := evidenceDisposition(
		t,
		service,
		second,
	); disposition.Outcome != "accepted" {
		t.Fatalf("second coverage = %#v", disposition)
	}

	now = now.Add(2*time.Hour + 30*time.Minute)
	runEvidenceRetentionForTest(t, service, now)
	assertCoverageRetentionCounts(t, service, 1, 1, 0)

	now = now.Add(31 * time.Minute)
	runEvidenceRetentionForTest(t, service, now)
	assertCoverageRetentionCounts(t, service, 0, 0, 1)
	for _, record := range []Record{first, second} {
		assertEvidenceQueryCount(
			t,
			service,
			"expired coverage raw record",
			`SELECT count(*) FROM records WHERE record_id = ?`,
			record.RecordID,
			0,
		)
	}
	var recordCount, eventCount int
	if err := service.db.QueryRow(`
		SELECT record_count, event_count FROM runs
		WHERE run_id = 'run_coverage_projection'
	`).Scan(&recordCount, &eventCount); err != nil {
		t.Fatal(err)
	}
	if recordCount != 0 || eventCount != 0 {
		t.Fatalf(
			"coverage run rollups = %d records/%d events",
			recordCount,
			eventCount,
		)
	}
}

func assertCoverageRetentionCounts(
	t *testing.T,
	service *Service,
	wantEvents int,
	wantSupport int,
	wantWatermark int,
) {
	t.Helper()
	var events int
	if err := service.db.QueryRow(`
		SELECT count(*) FROM evidence_coverage_events
		WHERE subject_kind = 'span'
		  AND subject_id = '2222222222222222'
		  AND role = 'verification'
	`).Scan(&events); err != nil {
		t.Fatal(err)
	}
	var supports int
	if err := service.db.QueryRow(`
		SELECT coalesce(sum(support_count), 0)
		FROM evidence_coverage_projection
		WHERE subject_kind = 'span'
		  AND subject_id = '2222222222222222'
		  AND role = 'verification'
	`).Scan(&supports); err != nil {
		t.Fatal(err)
	}
	var watermarks int
	if err := service.db.QueryRow(`
		SELECT count(*) FROM evidence_truncation_watermarks
		WHERE subject_kind = 'span'
		  AND subject_id = '2222222222222222'
		  AND role = 'verification'
	`).Scan(&watermarks); err != nil {
		t.Fatal(err)
	}
	if events != wantEvents || supports != wantSupport ||
		watermarks != wantWatermark {
		t.Fatalf(
			"coverage retention = %d events/%d supports/%d watermarks, want %d/%d/%d",
			events,
			supports,
			watermarks,
			wantEvents,
			wantSupport,
			wantWatermark,
		)
	}
}
