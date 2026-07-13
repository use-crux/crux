package observability

import (
	"context"
	"testing"
)

func TestServiceOrdersRawRecordsBySegmentSequence(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_segment_order_a","type":"span:start","runId":"run_segment_order","segmentId":"seg_segment_order_a","traceId":"11111111111111111111111111111111","segmentSeq":2,"spanId":"2222222222222222","family":"tool","primitive":"tool.call","name":"second by segment order","startedAt":"2026-05-16T18:00:00.010Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_segment_order_b","type":"run:start","runId":"run_segment_order","segmentId":"seg_segment_order_a","traceId":"11111111111111111111111111111111","segmentSeq":1,"name":"first by segment order","rootPrimitive":"tool.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_segment_order_c","type":"span:end","runId":"run_segment_order","segmentId":"seg_segment_order_a","traceId":"11111111111111111111111111111111","segmentSeq":3,"spanId":"2222222222222222","endedAt":"2026-05-16T18:00:00.020Z","status":"ok"}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	graph, err := service.Graph(ctx, "run_segment_order")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := recordIDs(graph.Records), []string{"rec_segment_order_b", "rec_segment_order_a", "rec_segment_order_c"}; !equalStringSlices(got, want) {
		t.Fatalf("raw record order = %#v, want %#v", got, want)
	}
}

func TestServiceOrdersRawRecordsBySegmentCausalityBeforeSegmentID(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_causal_resume","type":"run:resume","runId":"run_causal_order","segmentId":"seg_a_resume","traceId":"55555555555555555555555555555555","segmentSeq":1,"resumedAt":"2026-05-16T18:01:00.000Z","reason":"signal","previousSegmentId":"seg_z_start"}`,
		`{"schemaVersion":2,"recordId":"rec_causal_end","type":"run:end","runId":"run_causal_order","segmentId":"seg_a_resume","traceId":"55555555555555555555555555555555","segmentSeq":2,"endedAt":"2026-05-16T18:01:01.000Z","status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_causal_start","type":"run:start","runId":"run_causal_order","segmentId":"seg_z_start","traceId":"55555555555555555555555555555555","segmentSeq":1,"name":"causal","rootPrimitive":"flow.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_causal_suspend","type":"run:suspend","runId":"run_causal_order","segmentId":"seg_z_start","traceId":"55555555555555555555555555555555","segmentSeq":2,"suspendedAt":"2026-05-16T18:00:01.000Z","reason":"await-signal"}`,
	)); err != nil {
		t.Fatal(err)
	}
	graph, err := service.Graph(ctx, "run_causal_order")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := recordIDs(graph.Records), []string{"rec_causal_start", "rec_causal_suspend", "rec_causal_resume", "rec_causal_end"}; !equalStringSlices(got, want) {
		t.Fatalf("causal raw order = %#v, want %#v", got, want)
	}
}

func TestResolveRunIDsKeepsNewestTraceAliasWinner(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	for _, row := range []struct{ runID, startedAt string }{{"run_alias_old", "2026-05-16T18:00:00.000Z"}, {"run_alias_new", "2026-05-16T18:01:00.000Z"}} {
		if _, err := service.db.ExecContext(ctx, `INSERT INTO runs (run_id, trace_id, started_at) VALUES (?, 'trace_alias', ?)`, row.runID, row.startedAt); err != nil {
			t.Fatal(err)
		}
	}
	resolved, err := service.ResolveRunIDs(ctx, []string{"trace_alias"})
	if err != nil {
		t.Fatal(err)
	}
	if resolved["trace_alias"] != "run_alias_new" {
		t.Fatalf("trace alias winner = %q, want newest run", resolved["trace_alias"])
	}
	run, err := service.Run(ctx, "run_alias_new")
	if err != nil {
		t.Fatal(err)
	}
	if !run.TraceAliasConflict {
		t.Fatalf("run = %#v, want trace alias conflict diagnostic", run)
	}
}

func recordIDs(records []StoredRecord) []string {
	ids := make([]string, 0, len(records))
	for _, record := range records {
		ids = append(ids, record.RecordID)
	}
	return ids
}

func equalStringSlices(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
