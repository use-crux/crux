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
