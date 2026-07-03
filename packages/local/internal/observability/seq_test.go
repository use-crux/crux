package observability

import (
	"context"
	"testing"
)

func TestServiceOrdersRawRecordsByRunSequence(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":1,"recordId":"rec_seq_a","type":"span:start","runId":"run_seq_order","traceId":"11111111111111111111111111111111","seq":2,"spanId":"2222222222222222","family":"tool","primitive":"tool.call","name":"second by seq","startedAt":"2026-05-16T18:00:00.010Z","status":"running"}`,
		`{"schemaVersion":1,"recordId":"rec_seq_b","type":"run:start","runId":"run_seq_order","traceId":"11111111111111111111111111111111","seq":1,"name":"first by seq","rootPrimitive":"tool.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":1,"recordId":"rec_seq_c","type":"span:end","runId":"run_seq_order","traceId":"11111111111111111111111111111111","seq":3,"spanId":"2222222222222222","endedAt":"2026-05-16T18:00:00.020Z","status":"ok"}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	graph, err := service.Graph(ctx, "run_seq_order")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := recordIDs(graph.Records), []string{"rec_seq_b", "rec_seq_a", "rec_seq_c"}; !equalStringSlices(got, want) {
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
