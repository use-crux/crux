package observability

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
)

func ingestRunStart(t *testing.T, service *Service, runID, segmentID, traceID, status, startedAt string) {
	t.Helper()
	if err := service.Ingest(context.Background(), mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_start_`+runID+`","type":"run:start","runId":"`+runID+`","segmentId":"`+segmentID+`","segmentSeq":1,"traceId":"`+traceID+`","name":"n","rootPrimitive":"agent.run","startedAt":"`+startedAt+`","status":"`+status+`"}`,
	)); err != nil {
		t.Fatalf("ingest run start %s: %v", runID, err)
	}
}

func TestRunsPageIncludesRevisionThatAdvancesOnlyAfterCommit(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)

	page, err := service.RunsPage(ctx, RunListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if page.Revision != 0 {
		t.Fatalf("initial revision = %d, want 0", page.Revision)
	}

	ingestRunStart(t, service, "run_rev_a", "seg_rev_a", "trace_rev_a", "running", "2026-05-16T18:00:00.000Z")

	page, err = service.RunsPage(ctx, RunListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if page.Revision == 0 {
		t.Fatal("revision did not advance after a committed ingest")
	}
	if len(page.Rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(page.Rows))
	}
	if page.Rows[0].Revision == 0 {
		t.Fatal("run summary revision was not populated")
	}
	firstRevision := page.Revision

	ingestRunStart(t, service, "run_rev_b", "seg_rev_b", "trace_rev_b", "running", "2026-05-16T18:01:00.000Z")

	page, err = service.RunsPage(ctx, RunListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if page.Revision <= firstRevision {
		t.Fatalf("revision = %d, want > %d after second commit", page.Revision, firstRevision)
	}
}

func TestRunsPageRevisionOnlyPublishedAfterIngestCommits(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	events := service.events.Subscribe(ctx)

	ingestRunStart(t, service, "run_rev_publish", "seg_rev_publish", "trace_rev_publish", "running", "2026-05-16T18:00:00.000Z")

	select {
	case event := <-events:
		if event.Kind != "observability.records" {
			t.Fatalf("event kind = %q", event.Kind)
		}
		var payload struct {
			Revision int64  `json:"revision"`
			RunID    string `json:"runId"`
		}
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if payload.Revision == 0 {
			t.Fatal("published event did not carry a post-commit revision")
		}
		if payload.RunID != "run_rev_publish" {
			t.Fatalf("runId = %q", payload.RunID)
		}
	default:
		t.Fatal("expected an ingest event to be published after commit")
	}
}

func ingestTerminalRun(t *testing.T, service *Service, runID, status, startedAt string) {
	t.Helper()
	segmentID := "seg_" + runID
	traceID := "trace_" + runID
	if err := service.Ingest(context.Background(), mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_start_`+runID+`","type":"run:start","runId":"`+runID+`","segmentId":"`+segmentID+`","segmentSeq":1,"traceId":"`+traceID+`","name":"n","rootPrimitive":"agent.run","startedAt":"`+startedAt+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_end_`+runID+`","type":"run:end","runId":"`+runID+`","segmentId":"`+segmentID+`","segmentSeq":2,"traceId":"`+traceID+`","endedAt":"`+startedAt+`","status":"`+status+`"}`,
	)); err != nil {
		t.Fatalf("ingest terminal run %s: %v", runID, err)
	}
}

func TestRunsPageFiltersByStatusAcrossFullHistoryNotJustTheNewestWindow(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)

	// Insert more "ok" runs, all newer than one "error" run, so a naive
	// newest-first truncation applied before filtering would drop the error
	// run entirely instead of finding it.
	for i := 0; i < 5; i++ {
		runID := fmt.Sprintf("run_status_ok_%d", i)
		ingestTerminalRun(t, service, runID, "ok", fmt.Sprintf("2026-05-16T19:00:%02d.000Z", i))
	}
	ingestTerminalRun(t, service, "run_status_error", "error", "2026-05-16T10:00:00.000Z")

	page, err := service.RunsPage(ctx, RunListOptions{Limit: 3, Status: []string{"error"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Rows) != 1 || page.Rows[0].RunID != "run_status_error" {
		t.Fatalf("rows = %#v, want exactly the error run", page.Rows)
	}
}

func TestRunsPageCursorPaginationIsStableAcrossConcurrentInserts(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	for i := 0; i < 3; i++ {
		runID := fmt.Sprintf("run_cursor_%d", i)
		ingestRunStart(t, service, runID, "seg_"+runID, "trace_"+runID, "ok", fmt.Sprintf("2026-05-16T20:00:%02d.000Z", i))
	}

	firstPage, err := service.RunsPage(ctx, RunListOptions{Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(firstPage.Rows) != 2 || firstPage.NextCursor == "" {
		t.Fatalf("first page = %#v", firstPage)
	}

	// A new, newer run lands between pages; the cursor must not reshow or skip
	// rows relative to what the first page already returned.
	ingestRunStart(t, service, "run_cursor_new", "seg_cursor_new", "trace_cursor_new", "ok", "2026-05-16T20:05:00.000Z")

	secondPage, err := service.RunsPage(ctx, RunListOptions{Limit: 2, Cursor: firstPage.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range secondPage.Rows {
		for _, prior := range firstPage.Rows {
			if row.RunID == prior.RunID {
				t.Fatalf("second page repeated run %q from the first page", row.RunID)
			}
		}
		if row.RunID == "run_cursor_new" {
			t.Fatalf("second page unexpectedly included the newly inserted run %q", row.RunID)
		}
	}
}

func TestRunsPageBatchesEnrichmentAcrossManyRuns(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	for i := 0; i < 12; i++ {
		runID := fmt.Sprintf("run_bulk_%d", i)
		ingestRunStart(t, service, runID, "seg_"+runID, "trace_"+runID, "ok", fmt.Sprintf("2026-05-16T21:00:%02d.000Z", i))
	}

	page, err := service.RunsPage(ctx, RunListOptions{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Rows) != 12 {
		t.Fatalf("rows = %d, want 12", len(page.Rows))
	}
	for _, row := range page.Rows {
		if row.Revision == 0 {
			t.Fatalf("run %q missing revision", row.RunID)
		}
		if row.DeliveryHealth == nil || row.DeliveryHealth.Status != "unknown" {
			t.Fatalf("run %q delivery health = %#v, want unknown", row.RunID, row.DeliveryHealth)
		}
	}
}

func TestRunsPageDeliveryHealthIsUnknownWithoutIngestConflictsAndDegradedWithThem(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	ingestRunStart(t, service, "run_health_unknown", "seg_health_unknown", "trace_health_unknown", "ok", "2026-05-16T22:00:00.000Z")

	page, err := service.RunsPage(ctx, RunListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Rows) != 1 {
		t.Fatalf("rows = %#v", page.Rows)
	}
	if page.Rows[0].DeliveryHealth == nil || page.Rows[0].DeliveryHealth.Status != "unknown" {
		t.Fatalf("delivery health = %#v, want unknown with no persisted correlation", page.Rows[0].DeliveryHealth)
	}

	// Reingesting the same record id with different content records an
	// ingest-health conflict scoped to this run.
	conflict := mustBatch(t, `{"schemaVersion":2,"recordId":"rec_start_run_health_unknown","type":"run:start","runId":"run_health_unknown","segmentId":"seg_health_unknown","segmentSeq":1,"traceId":"trace_health_unknown","name":"different","rootPrimitive":"agent.run","startedAt":"2026-05-16T22:00:00.000Z","status":"running"}`)
	if err := service.Ingest(ctx, conflict); err == nil {
		t.Fatal("expected a record identity conflict")
	}

	page, err = service.RunsPage(ctx, RunListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if page.Rows[0].DeliveryHealth == nil || page.Rows[0].DeliveryHealth.Status != "degraded" {
		t.Fatalf("delivery health = %#v, want degraded after an ingest conflict", page.Rows[0].DeliveryHealth)
	}
	if page.Rows[0].DeliveryHealth.Rejected < 1 {
		t.Fatalf("delivery health rejected = %d, want >= 1", page.Rows[0].DeliveryHealth.Rejected)
	}
}

func TestRunsPageDeliveryHealthIsHealthyForAFullyDeliveredTerminalRun(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	ingestRunStart(t, service, "run_health_ok", "seg_health_ok", "trace_health_ok", "running", "2026-05-16T23:00:00.000Z")

	end := mustBatch(t, `{"schemaVersion":2,"recordId":"rec_end_run_health_ok","type":"run:end","runId":"run_health_ok","segmentId":"seg_health_ok","segmentSeq":2,"traceId":"trace_health_ok","endedAt":"2026-05-16T23:00:01.000Z","durationMs":1000,"status":"ok"}`)
	if err := service.Ingest(ctx, end); err != nil {
		t.Fatalf("ingest run end: %v", err)
	}

	page, err := service.RunsPage(ctx, RunListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Rows) != 1 {
		t.Fatalf("rows = %#v", page.Rows)
	}
	row := page.Rows[0]
	if row.Status != "ok" || row.EndedAt == "" {
		t.Fatalf("run did not reach a clean terminal state: %#v", row)
	}
	if row.GapCount != 0 || row.OrderingConfidence != "causal" || row.TraceAliasConflict {
		t.Fatalf("run is not a clean single-segment delivery: gapCount=%d orderingConfidence=%q traceAliasConflict=%v", row.GapCount, row.OrderingConfidence, row.TraceAliasConflict)
	}
	if row.DeliveryHealth == nil || row.DeliveryHealth.Status != "healthy" {
		t.Fatalf("delivery health = %#v, want healthy for a fully-delivered terminal run", row.DeliveryHealth)
	}
}

func TestRunsPageDeliveryHealthStaysUnknownForARunningRun(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	ingestRunStart(t, service, "run_health_running", "seg_health_running", "trace_health_running", "running", "2026-05-16T23:05:00.000Z")

	page, err := service.RunsPage(ctx, RunListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Rows) != 1 {
		t.Fatalf("rows = %#v", page.Rows)
	}
	if page.Rows[0].DeliveryHealth == nil || page.Rows[0].DeliveryHealth.Status != "unknown" {
		t.Fatalf("delivery health = %#v, want unknown for a still-running run", page.Rows[0].DeliveryHealth)
	}
}
