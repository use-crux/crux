package observability

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestOperationFamilyChildBeforeRootIsStableAndAggregated(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	operationID := "run_operation_family"
	childID := "run_operation_child"
	traceID := "11111111111111111111111111111111"

	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":4,"recordId":"child-start","type":"run:start","runId":"`+childID+`","operationId":"`+operationID+`","parentRunId":"`+operationID+`","triggeredBySpanId":"root-trigger","segmentId":"child-segment","segmentSeq":1,"traceId":"`+traceID+`","name":"research","rootPrimitive":"flow.run","startedAt":"2026-07-20T12:00:01Z","status":"running"}`,
	)); err != nil {
		t.Fatal(err)
	}
	before, err := service.RunsPage(ctx, RunListOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Rows) != 1 || before.Rows[0].OperationID != operationID || before.Rows[0].RootPresent || before.Rows[0].Status != "incomplete" || before.Rows[0].ChildRunCount != 1 {
		t.Fatalf("child-before-root shell = %#v", before.Rows)
	}
	firstSeenAt := before.Rows[0].FirstSeenAt
	shellDetail, err := service.RunDetail(ctx, operationID)
	if err != nil || shellDetail.Run.RootPresent || len(shellDetail.MemberRuns) != 1 {
		t.Fatalf("child-before-root detail = %#v, err = %v", shellDetail, err)
	}

	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":4,"recordId":"root-start","type":"run:start","runId":"`+operationID+`","operationId":"`+operationID+`","segmentId":"root-segment","segmentSeq":1,"traceId":"`+traceID+`","name":"request","rootPrimitive":"agent.run","startedAt":"2026-07-20T12:00:00Z","status":"running"}`,
		`{"schemaVersion":4,"recordId":"root-trigger-start","type":"span:start","runId":"`+operationID+`","operationId":"`+operationID+`","segmentId":"root-segment","segmentSeq":2,"traceId":"`+traceID+`","spanId":"root-trigger","family":"flow","primitive":"flow.run","name":"research","startedAt":"2026-07-20T12:00:00.500Z","status":"running"}`,
		`{"schemaVersion":4,"recordId":"child-end","type":"run:end","runId":"`+childID+`","operationId":"`+operationID+`","segmentId":"child-segment","segmentSeq":2,"traceId":"`+traceID+`","endedAt":"2026-07-20T12:00:02Z","status":"error"}`,
		`{"schemaVersion":4,"recordId":"root-end","type":"run:end","runId":"`+operationID+`","operationId":"`+operationID+`","segmentId":"root-segment","segmentSeq":3,"traceId":"`+traceID+`","endedAt":"2026-07-20T12:00:03Z","status":"ok"}`,
	)); err != nil {
		t.Fatal(err)
	}
	after, err := service.RunsPage(ctx, RunListOptions{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Rows) != 1 {
		t.Fatalf("operation rows = %d, want one", len(after.Rows))
	}
	row := after.Rows[0]
	if !row.RootPresent || row.Status != "ok" || row.ChildRunCount != 1 || row.FailedChildCount != 1 || row.FirstSeenAt != firstSeenAt {
		t.Fatalf("completed operation = %#v", row)
	}
	if row.RecordCount != 5 || row.TopologyHealth != "healthy" {
		t.Fatalf("operation aggregate/topology = %#v", row)
	}
	detail, err := service.RunDetail(ctx, operationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.MemberRuns) != 2 {
		t.Fatalf("detail member runs = %d, want 2", len(detail.MemberRuns))
	}
	trigger := detail.SpanIndex["root-trigger"]
	mounted := false
	for _, detailRow := range detail.Rows {
		if detailRow.NodeID == "run:"+childID && detailRow.ParentID == trigger.NodeID {
			mounted = true
			break
		}
	}
	if !mounted {
		t.Fatalf("child run was not mounted beneath trigger %q: %#v", trigger.NodeID, detail.Rows)
	}
	if detail.Run.ChildRunCount != 1 || detail.Run.FailedChildCount != 1 || detail.Run.RecordCount != 5 {
		t.Fatalf("detail operation aggregate = %#v", detail.Run)
	}
}

func TestOperationFamiliesNeverGroupBySharedTrace(t *testing.T) {
	service := newTestService(t)
	traceID := "22222222222222222222222222222222"
	if err := service.Ingest(context.Background(), mustBatch(t,
		`{"schemaVersion":4,"recordId":"shared-a","type":"run:start","runId":"run_shared_a","operationId":"run_shared_a","segmentId":"seg-shared-a","segmentSeq":1,"traceId":"`+traceID+`","name":"a","rootPrimitive":"agent.run","startedAt":"2026-07-20T13:00:00Z","status":"running"}`,
		`{"schemaVersion":4,"recordId":"shared-b","type":"run:start","runId":"run_shared_b","operationId":"run_shared_b","segmentId":"seg-shared-b","segmentSeq":1,"traceId":"`+traceID+`","name":"b","rootPrimitive":"eval.case","startedAt":"2026-07-20T13:00:01Z","status":"running"}`,
	)); err != nil {
		t.Fatal(err)
	}
	runs, err := service.Runs(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 2 {
		t.Fatalf("shared trace produced %d operations, want 2", len(runs))
	}
}

func TestOperationIdentityIsImmutable(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":4,"recordId":"identity-root","type":"run:start","runId":"run_identity_root","operationId":"run_identity_root","segmentId":"identity-segment","segmentSeq":1,"name":"root","rootPrimitive":"run","startedAt":"2026-07-20T14:00:00Z","status":"running"}`,
	)); err != nil {
		t.Fatal(err)
	}
	err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":4,"recordId":"identity-conflict","type":"span:event","runId":"run_identity_root","operationId":"run_other_operation","segmentId":"identity-segment","segmentSeq":2,"spanId":"span","eventId":"event","name":"custom.identity","timestamp":"2026-07-20T14:00:01Z"}`,
	))
	if err == nil || !strings.Contains(err.Error(), "operation_identity_conflict") {
		t.Fatalf("identity conflict error = %v", err)
	}
}

func TestDeletedOperationCannotBeResurrected(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":4,"recordId":"delete-root","type":"run:start","runId":"run_delete_operation","operationId":"run_delete_operation","segmentId":"delete-segment","segmentSeq":1,"name":"delete","rootPrimitive":"run","startedAt":"2026-07-20T15:00:00Z","status":"running"}`,
	)); err != nil {
		t.Fatal(err)
	}
	deleted, err := service.DeleteRuns(ctx, []string{"run_delete_operation"})
	if err != nil || len(deleted) != 1 || deleted[0] != "run_delete_operation" {
		t.Fatalf("delete = %v, %v", deleted, err)
	}
	dispositions := service.IngestWithDispositions(ctx, mustBatch(t,
		`{"schemaVersion":4,"recordId":"delete-late","type":"run:end","runId":"run_delete_operation","operationId":"run_delete_operation","segmentId":"delete-segment","segmentSeq":2,"endedAt":"2026-07-20T15:00:01Z","status":"ok"}`,
	))
	if len(dispositions) != 1 || dispositions[0].Code != "operation_deleted" || dispositions[0].Retryable {
		t.Fatalf("late deletion disposition = %#v", dispositions)
	}
}

func TestRetentionKeepsActiveFamiliesAndDeletesTerminalFamiliesAtomically(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":4,"recordId":"active-root","type":"run:start","runId":"run_active_family","operationId":"run_active_family","segmentId":"active-root-seg","segmentSeq":1,"name":"active","rootPrimitive":"run","startedAt":"2020-01-01T00:00:00Z","status":"running"}`,
		`{"schemaVersion":4,"recordId":"active-root-end","type":"run:end","runId":"run_active_family","operationId":"run_active_family","segmentId":"active-root-seg","segmentSeq":2,"endedAt":"2020-01-01T00:00:01Z","status":"ok"}`,
		`{"schemaVersion":4,"recordId":"active-child","type":"run:start","runId":"run_active_child","operationId":"run_active_family","parentRunId":"run_active_family","triggeredBySpanId":"missing-trigger","segmentId":"active-child-seg","segmentSeq":1,"name":"child","rootPrimitive":"flow.run","startedAt":"2020-01-01T00:00:00Z","status":"running"}`,
		`{"schemaVersion":4,"recordId":"terminal-root","type":"run:start","runId":"run_terminal_family","operationId":"run_terminal_family","segmentId":"terminal-seg","segmentSeq":1,"name":"terminal","rootPrimitive":"run","startedAt":"2020-01-01T00:00:00Z","status":"running"}`,
		`{"schemaVersion":4,"recordId":"terminal-end","type":"run:end","runId":"run_terminal_family","operationId":"run_terminal_family","segmentId":"terminal-seg","segmentSeq":2,"endedAt":"2020-01-01T00:00:01Z","status":"ok"}`,
	)); err != nil {
		t.Fatal(err)
	}
	deleted, err := service.runRetention(ctx, retentionSettings{MaxRunAge: time.Hour, MaxRuns: 100}, time.Date(2026, 7, 20, 16, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 1 {
		t.Fatalf("deleted operations = %d, want 1", deleted)
	}
	rows, err := service.Runs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].OperationID != "run_active_family" || rows[0].ActiveChildCount != 1 {
		t.Fatalf("retained operations = %#v", rows)
	}
}

func TestMalformedOperationTopologyIsBoundedAndVisible(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":4,"recordId":"cycle-a","type":"run:start","runId":"run_cycle_a","operationId":"run_cycle_root","parentRunId":"run_cycle_b","segmentId":"cycle-a-seg","segmentSeq":1,"name":"a","rootPrimitive":"flow.run","startedAt":"2026-07-20T17:00:00Z","status":"running"}`,
		`{"schemaVersion":4,"recordId":"cycle-b","type":"run:start","runId":"run_cycle_b","operationId":"run_cycle_root","parentRunId":"run_cycle_a","segmentId":"cycle-b-seg","segmentSeq":1,"name":"b","rootPrimitive":"flow.run","startedAt":"2026-07-20T17:00:01Z","status":"running"}`,
		`{"schemaVersion":4,"recordId":"self-parent","type":"run:start","runId":"run_self_parent","operationId":"run_cycle_root","parentRunId":"run_self_parent","segmentId":"self-seg","segmentSeq":1,"name":"self","rootPrimitive":"flow.run","startedAt":"2026-07-20T17:00:02Z","status":"running"}`,
	)); err != nil {
		t.Fatal(err)
	}
	detail, err := service.RunDetail(ctx, "run_cycle_root")
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.MemberRuns) != 3 || !hasRunDetailDiagnosticCode(detail.Diagnostics, "parent-run-cycle") || !hasRunDetailDiagnosticCode(detail.Diagnostics, "self-parent-run") {
		t.Fatalf("malformed topology detail = members:%d diagnostics:%#v", len(detail.MemberRuns), detail.Diagnostics)
	}
}

func hasRunDetailDiagnosticCode(diagnostics []RunDetailDiagnostic, code string) bool {
	for _, diagnostic := range diagnostics {
		if diagnostic.Code == code {
			return true
		}
	}
	return false
}
