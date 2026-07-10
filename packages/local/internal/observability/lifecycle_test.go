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
	assertLifecycleEvent(t, events, "run_lifecycle_persisted", "stale")
	assertStoredLifecycleStatus(t, service, "run_lifecycle_persisted", "reconciled-stale")

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
	select {
	case event := <-events:
		t.Fatalf("active streaming run produced lifecycle event = %#v", event)
	default:
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
		if _, err := service.db.ExecContext(ctx, `
			INSERT INTO runs (run_id, trace_id, name, root_primitive, status, started_at, last_activity_at, lifecycle_status)
			VALUES (?, ?, 'stale', 'agent.run', 'running', ?, ?, 'reconciled-stale')
		`, fmt.Sprintf("run_reconciled_%02d", i), fmt.Sprintf("trace_reconciled_%02d", i), started, started); err != nil {
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
