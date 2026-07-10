package observability

import (
	"context"
	"testing"
)

func TestIngestWithDispositionsCoalescesHealthyBatch(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	service := newTestService(t)
	events := service.Events().Subscribe(ctx)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_batch_start","type":"run:start","runId":"run_batch_receipts","segmentId":"seg_batch_receipts_a","segmentSeq":1,"traceId":"11111111111111111111111111111111","name":"batch","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_batch_end","type":"run:end","runId":"run_batch_receipts","segmentId":"seg_batch_receipts_a","segmentSeq":2,"traceId":"11111111111111111111111111111111","endedAt":"2026-05-16T18:00:00.100Z","durationMs":100,"status":"ok"}`,
	)

	dispositions := service.IngestWithDispositions(ctx, batch)

	if len(dispositions) != 2 || dispositions[0].Outcome != "accepted" || dispositions[1].Outcome != "accepted" {
		t.Fatalf("dispositions = %#v, want both records accepted", dispositions)
	}
	first := <-events
	if first.Kind != "observability.records" || first.RefID != "run_batch_receipts" {
		t.Fatalf("event = %#v, want coalesced batch event", first)
	}
	select {
	case duplicate := <-events:
		t.Fatalf("healthy batch produced duplicate ingest event: %#v", duplicate)
	default:
	}
}

func TestIngestWithDispositionsIsolatesPoisonAndKeepsExactDuplicatesIdempotent(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	start := `{"schemaVersion":2,"recordId":"rec_mixed_start","type":"run:start","runId":"run_mixed_receipts","segmentId":"seg_mixed_receipts_a","segmentSeq":1,"traceId":"22222222222222222222222222222222","name":"mixed","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`
	batch := mustBatch(t,
		start,
		`{"schemaVersion":2,"recordId":"rec_mixed_poison","type":"span","runId":"run_mixed_receipts","segmentId":"seg_mixed_receipts_a","segmentSeq":2,"traceId":"22222222222222222222222222222222","spanId":"3333333333333333","family":"tool","primitive":"generation.call","name":"poison","startedAt":"2026-05-16T18:00:00.010Z","status":"ok"}`,
		start,
		`{"schemaVersion":2,"recordId":"rec_mixed_end","type":"run:end","runId":"run_mixed_receipts","segmentId":"seg_mixed_receipts_a","segmentSeq":3,"traceId":"22222222222222222222222222222222","endedAt":"2026-05-16T18:00:00.100Z","durationMs":100,"status":"ok"}`,
	)

	dispositions := service.IngestWithDispositions(ctx, batch)

	if len(dispositions) != 4 ||
		dispositions[0].Index != 0 || dispositions[0].Outcome != "accepted" ||
		dispositions[1].Index != 1 || dispositions[1].Code != "invalid_record" || dispositions[1].Retryable ||
		dispositions[2].Index != 2 || dispositions[2].Outcome != "accepted" ||
		dispositions[3].Index != 3 || dispositions[3].Outcome != "accepted" {
		t.Fatalf("dispositions = %#v, want poison isolated with exact duplicate accepted", dispositions)
	}
	run, err := service.Run(ctx, "run_mixed_receipts")
	if err != nil {
		t.Fatal(err)
	}
	if run.RecordCount != 2 {
		t.Fatalf("record count = %d, want one start and one end without duplicate rollups", run.RecordCount)
	}
}
