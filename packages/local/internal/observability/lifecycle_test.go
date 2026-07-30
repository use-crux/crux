package observability

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestServiceLifecycleReconcilesStaleRunOnceAndPersistsStatus(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service := newTestService(t)
	events := service.Events().Subscribe(ctx)
	started := time.Now().Add(-2 * time.Minute).UTC()

	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_run_start","type":"run:start","runId":"run_lifecycle_persisted","segmentId":"seg_lifecycle_persisted_a","segmentSeq":1,"traceId":"trace_lifecycle_persisted","name":"chat","rootPrimitive":"agent.run","startedAt":"`+started.Format(time.RFC3339Nano)+`","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_agent","type":"span:start","runId":"run_lifecycle_persisted","segmentId":"seg_lifecycle_persisted_a","segmentSeq":2,"traceId":"trace_lifecycle_persisted","spanId":"span_chat","family":"agent","primitive":"agent.run","name":"chat","startedAt":"`+started.Format(time.RFC3339Nano)+`","status":"running"}`,
	)
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}
	drainEvents(events)

	if err := service.PublishLifecycleReconciliations(ctx); err != nil {
		t.Fatal(err)
	}
	assertLifecycleEvent(t, events, "run_lifecycle_persisted", "incomplete")
	assertStoredLifecycleStatus(t, service, "run_lifecycle_persisted", "reconciled-incomplete")

	candidates, err := service.lifecycleCandidateRuns(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 0 {
		t.Fatalf("candidate count after reconciliation = %d, want 0", len(candidates))
	}
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}
	drainEvents(events)
	candidates, err = service.lifecycleCandidateRuns(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 0 {
		t.Fatalf("candidate count after duplicate delivery = %d, want 0", len(candidates))
	}

	if err := service.PublishLifecycleReconciliations(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-events:
		t.Fatalf("duplicate lifecycle event = %#v", event)
	default:
	}
}

func TestServiceLifecycleKeepsActiveStreamingRunLive(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service := newTestService(t)
	events := service.Events().Subscribe(ctx)
	started := time.Now().Add(-2 * time.Minute).UTC()
	chunkedAt := time.Now().UTC()

	if err := service.Ingest(ctx, mustBatch(t,
		lifecycleRecordJSON("rec_live_run_start", "run_live_stream", "", started),
		lifecycleRecordJSON("rec_live_span_start", "run_live_stream", "span_live_stream", started.Add(time.Millisecond)),
		fmt.Sprintf(`{"schemaVersion":2,"recordId":"rec_live_chunk","type":"span:event","runId":"run_live_stream","segmentId":"seg_live_stream_a","segmentSeq":3,"traceId":"trace_live_stream","spanId":"span_live_stream","eventId":"event_live_chunk","name":"token.chunk","timestamp":%q,"attributes":{"chunkIndex":0,"charCount":5,"text":"hello","firstDeltaAt":%q,"lastDeltaAt":%q}}`,
			chunkedAt.Format(time.RFC3339Nano), chunkedAt.Format(time.RFC3339Nano), chunkedAt.Format(time.RFC3339Nano)),
	)); err != nil {
		t.Fatal(err)
	}
	drainEvents(events)

	detail, err := service.RunDetail(ctx, "run_live_stream")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Run.Status != "running" || detail.Root.Status != "running" {
		t.Fatalf("presentation statuses = %q/%q, want running/running", detail.Run.Status, detail.Root.Status)
	}
	if len(detail.Diagnostics) != 0 {
		t.Fatalf("diagnostics = %#v, want none while stream is active", detail.Diagnostics)
	}

	if err := service.PublishLifecycleReconciliations(ctx); err != nil {
		t.Fatal(err)
	}
	for {
		select {
		case event := <-events:
			if event.Kind == "observability.lifecycle" {
				t.Fatalf("active streaming run produced lifecycle event = %#v", event)
			}
		default:
			return
		}
	}
}

func TestRunsPageAfterRestartPresentsAndFiltersReconciledStatuses(t *testing.T) {
	ctx := context.Background()
	path := t.TempDir() + "/observability.sqlite"
	service, err := OpenService(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	staleAt := time.Now().Add(-2 * time.Minute).UTC()
	freshAt := time.Now().UTC()
	if err := service.Ingest(ctx, mustBatch(t,
		lifecycleRecordJSON("rec_stale_run_start", "run_stale_orphan", "", staleAt),
		lifecycleRecordJSON("rec_stale_span_start", "run_stale_orphan", "span_stale_orphan", staleAt.Add(time.Millisecond)),
		lifecycleRecordJSON("rec_ok_run_start", "run_reconciled_ok", "", staleAt),
		lifecycleRecordJSON("rec_ok_span_start", "run_reconciled_ok", "span_reconciled_ok", staleAt.Add(time.Millisecond)),
		lifecycleTerminalSpanJSON("rec_ok_span_end", "run_reconciled_ok", "span_reconciled_ok", "ok", staleAt.Add(time.Second)),
		lifecycleRecordJSON("rec_error_run_start", "run_reconciled_error", "", staleAt),
		lifecycleRecordJSON("rec_error_span_start", "run_reconciled_error", "span_reconciled_error", staleAt.Add(time.Millisecond)),
		lifecycleTerminalSpanJSON("rec_error_span_end", "run_reconciled_error", "span_reconciled_error", "error", staleAt.Add(time.Second)),
		lifecycleRecordJSON("rec_cancelled_run_start", "run_reconciled_cancelled", "", staleAt),
		lifecycleRecordJSON("rec_cancelled_span_start", "run_reconciled_cancelled", "span_reconciled_cancelled", staleAt.Add(time.Millisecond)),
		lifecycleTerminalSpanJSON("rec_cancelled_span_end", "run_reconciled_cancelled", "span_reconciled_cancelled", "cancelled", staleAt.Add(time.Second)),
		lifecycleRecordJSON("rec_fresh_run_start", "run_fresh_active", "", freshAt),
		lifecycleRecordJSON("rec_fresh_span_start", "run_fresh_active", "span_fresh_active", freshAt.Add(time.Millisecond)),
	)); err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenService(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	if err := reopened.PublishLifecycleReconciliations(ctx); err != nil {
		t.Fatal(err)
	}

	page, err := reopened.RunsPage(ctx, RunListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	statuses := map[string]string{}
	for _, run := range page.Rows {
		statuses[run.RunID] = run.Status
	}
	wantStatuses := map[string]string{
		"run_stale_orphan":         "incomplete",
		"run_reconciled_ok":        "ok",
		"run_reconciled_error":     "error",
		"run_reconciled_cancelled": "cancelled",
		"run_fresh_active":         "running",
	}
	for runID, want := range wantStatuses {
		if statuses[runID] != want {
			t.Fatalf("status for %s after restart = %q, want %q; all statuses = %#v", runID, statuses[runID], want, statuses)
		}
	}

	incomplete, err := reopened.RunsPage(ctx, RunListOptions{Status: []string{"incomplete"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(incomplete.Rows) != 1 || incomplete.Rows[0].RunID != "run_stale_orphan" {
		t.Fatalf("incomplete runs = %#v, want only stale orphan", incomplete.Rows)
	}
	running, err := reopened.RunsPage(ctx, RunListOptions{Status: []string{"running"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(running.Rows) != 1 || running.Rows[0].RunID != "run_fresh_active" {
		t.Fatalf("running runs = %#v, want only fresh active run", running.Rows)
	}
	for _, status := range []string{"ok", "error", "cancelled"} {
		page, err := reopened.RunsPage(ctx, RunListOptions{Status: []string{status}})
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Rows) != 1 || page.Rows[0].RunID != "run_reconciled_"+status {
			t.Fatalf("%s runs = %#v, want only run_reconciled_%s", status, page.Rows, status)
		}
	}
}

func TestServiceLifecycleSkipsRunDetailForAlreadyReconciledRuns(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	var detailBuilds int
	service.lifecycleRunDetail = func(context.Context, string) (RunDetail, error) {
		detailBuilds++
		return RunDetail{}, nil
	}
	started := time.Now().Add(-2 * time.Minute).UTC().Format(time.RFC3339Nano)
	for i := 0; i < 50; i++ {
		runID := fmt.Sprintf("run_reconciled_%02d", i)
		if _, err := service.db.ExecContext(ctx, `INSERT INTO operations (operation_id, first_seen_at, root_present) VALUES (?, ?, 1)`, runID, started); err != nil {
			t.Fatal(err)
		}
		if _, err := service.db.ExecContext(ctx, `
			INSERT INTO runs (run_id, operation_id, trace_id, name, root_primitive, status, started_at, last_activity_at, lifecycle_status)
			VALUES (?, ?, ?, 'incomplete', 'agent.run', 'running', ?, ?, 'reconciled-incomplete')
		`, runID, runID, fmt.Sprintf("trace_reconciled_%02d", i), started, started); err != nil {
			t.Fatal(err)
		}
	}

	if err := service.PublishLifecycleReconciliations(ctx); err != nil {
		t.Fatal(err)
	}
	if detailBuilds != 0 {
		t.Fatalf("RunDetail builds = %d, want 0", detailBuilds)
	}
}

func assertLifecycleEvent(t *testing.T, events <-chan Event, runID string, status string) {
	t.Helper()
	select {
	case event := <-events:
		if event.Kind != "observability.lifecycle" || event.Action != "reconciled" || event.RefID != runID {
			t.Fatalf("event = %#v", event)
		}
		var payload map[string]any
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			t.Fatal(err)
		}
		if payload["status"] != status {
			t.Fatalf("payload = %#v, want status %q", payload, status)
		}
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for lifecycle event for %s", runID)
	}
}

func assertStoredLifecycleStatus(t *testing.T, service *Service, runID string, want string) {
	t.Helper()
	var got string
	if err := service.db.QueryRow(`
		SELECT ifnull(lifecycle_status, '')
		FROM runs
		WHERE run_id = ?
	`, runID).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("lifecycle_status = %q, want %q", got, want)
	}
}

func lifecycleRecordJSON(recordID string, runID string, spanID string, started time.Time) string {
	segmentID := "seg_" + strings.TrimPrefix(runID, "run_") + "_a"
	if spanID == "" {
		return fmt.Sprintf(`{"schemaVersion":2,"recordId":%q,"type":"run:start","runId":%q,"segmentId":%q,"segmentSeq":1,"traceId":"trace_live_stream","name":"stream","rootPrimitive":"generation.stream","startedAt":%q,"status":"running"}`,
			recordID, runID, segmentID, started.Format(time.RFC3339Nano))
	}
	return fmt.Sprintf(`{"schemaVersion":2,"recordId":%q,"type":"span:start","runId":%q,"segmentId":%q,"segmentSeq":2,"traceId":"trace_live_stream","spanId":%q,"family":"generation","primitive":"generation.stream","name":"stream","startedAt":%q,"status":"running"}`,
		recordID, runID, segmentID, spanID, started.Format(time.RFC3339Nano))
}

func lifecycleTerminalSpanJSON(recordID string, runID string, spanID string, status string, ended time.Time) string {
	segmentID := "seg_" + strings.TrimPrefix(runID, "run_") + "_a"
	return fmt.Sprintf(`{"schemaVersion":2,"recordId":%q,"type":"span:end","runId":%q,"segmentId":%q,"segmentSeq":3,"traceId":"trace_live_stream","spanId":%q,"endedAt":%q,"status":%q}`,
		recordID, runID, segmentID, spanID, ended.Format(time.RFC3339Nano), status)
}
