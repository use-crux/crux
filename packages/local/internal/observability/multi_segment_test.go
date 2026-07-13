package observability

import (
	"context"
	"testing"
	"time"
)

func TestServiceProjectsOutOfOrderMultiSegmentLifecycle(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_oo_end","type":"run:end","runId":"run_oo","traceId":"11111111111111111111111111111111","segmentId":"seg_oo_b","segmentSeq":2,"endedAt":"2026-05-16T18:02:00.000Z","status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_oo_resume","type":"run:resume","runId":"run_oo","traceId":"11111111111111111111111111111111","segmentId":"seg_oo_b","segmentSeq":1,"resumedAt":"2026-05-16T18:01:00.000Z","reason":"signal","previousSegmentId":"seg_oo_a"}`,
		`{"schemaVersion":2,"recordId":"rec_oo_suspend","type":"run:suspend","runId":"run_oo","traceId":"11111111111111111111111111111111","segmentId":"seg_oo_a","segmentSeq":2,"suspendedAt":"2026-05-16T18:00:30.000Z","reason":"await-signal"}`,
		`{"schemaVersion":2,"recordId":"rec_oo_start","type":"run:start","runId":"run_oo","traceId":"11111111111111111111111111111111","segmentId":"seg_oo_a","segmentSeq":1,"name":"out of order","rootPrimitive":"flow.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
	)); err != nil {
		t.Fatal(err)
	}

	run, err := service.Run(ctx, "run_oo")
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "ok" || run.SegmentCount != 2 || run.OrderingConfidence != "causal" || run.GapCount != 0 {
		t.Fatalf("run projection = %#v", run)
	}
	assertSegmentProjection(t, service, "seg_oo_a", "suspended", "", "2026-05-16T18:00:30.000Z", "await-signal", "")
	assertSegmentProjection(t, service, "seg_oo_b", "ok", "2026-05-16T18:01:00.000Z", "", "signal", "seg_oo_a")
}

// Run detail and the graph endpoint must carry the same segment/ordering
// enrichment as the Runs list (service.Run), per binding spec 04 section 3's
// "run detail reads the same revisioned projection and shared presentation
// contract." A live smoke test against a real build found these two paths
// diverging: service.graph() (used by both RunDetail() and Graph()) never
// called the segment-summary enrichment service.Run() calls, so DevTools run
// detail's segment/gap/ordering-confidence reliability badge was always empty
// even when the Runs list correctly showed it.
func TestGraphAndRunDetailCarrySameSegmentEnrichmentAsRunsList(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_gd_start","type":"run:start","runId":"run_graph_detail","traceId":"55555555555555555555555555555555","segmentId":"seg_gd_a","segmentSeq":1,"name":"graph detail","rootPrimitive":"flow.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_gd_suspend","type":"run:suspend","runId":"run_graph_detail","traceId":"55555555555555555555555555555555","segmentId":"seg_gd_a","segmentSeq":2,"suspendedAt":"2026-05-16T18:00:01.000Z","reason":"await-signal"}`,
		`{"schemaVersion":2,"recordId":"rec_gd_resume","type":"run:resume","runId":"run_graph_detail","traceId":"55555555555555555555555555555555","segmentId":"seg_gd_b","segmentSeq":1,"resumedAt":"2026-05-16T18:00:02.000Z","reason":"signal","previousSegmentId":"seg_gd_a"}`,
		`{"schemaVersion":2,"recordId":"rec_gd_end","type":"run:end","runId":"run_graph_detail","traceId":"55555555555555555555555555555555","segmentId":"seg_gd_b","segmentSeq":2,"endedAt":"2026-05-16T18:00:03.000Z","durationMs":3000,"status":"ok"}`,
	)); err != nil {
		t.Fatal(err)
	}

	run, err := service.Run(ctx, "run_graph_detail")
	if err != nil {
		t.Fatal(err)
	}
	if run.SegmentCount != 2 || run.OrderingConfidence != "causal" || run.GapCount != 0 {
		t.Fatalf("Run() projection = %#v", run)
	}

	graph, err := service.Graph(ctx, "run_graph_detail")
	if err != nil {
		t.Fatal(err)
	}
	if graph.Run.SegmentCount != run.SegmentCount || graph.Run.OrderingConfidence != run.OrderingConfidence || graph.Run.GapCount != run.GapCount {
		t.Fatalf("Graph() run projection = %#v, want it to match Run() = %#v", graph.Run, run)
	}

	detail, err := service.RunDetail(ctx, "run_graph_detail")
	if err != nil {
		t.Fatal(err)
	}
	if detail.Run.SegmentCount != run.SegmentCount || detail.Run.OrderingConfidence != run.OrderingConfidence || detail.Run.GapCount != run.GapCount {
		t.Fatalf("RunDetail() run projection = %#v, want it to match Run() = %#v", detail.Run, run)
	}
}

func TestServiceMarksConcurrentSegmentsAsPartialOrder(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_parallel_start","type":"run:start","runId":"run_parallel","traceId":"22222222222222222222222222222222","segmentId":"seg_parallel_root","segmentSeq":1,"name":"parallel","rootPrimitive":"flow.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_parallel_suspend","type":"run:suspend","runId":"run_parallel","traceId":"22222222222222222222222222222222","segmentId":"seg_parallel_root","segmentSeq":2,"suspendedAt":"2026-05-16T18:00:01.000Z","reason":"fan-out"}`,
		`{"schemaVersion":2,"recordId":"rec_parallel_a","type":"run:resume","runId":"run_parallel","traceId":"22222222222222222222222222222222","segmentId":"seg_parallel_a","segmentSeq":1,"resumedAt":"2026-05-16T18:00:02.000Z","reason":"branch-a","previousSegmentId":"seg_parallel_root"}`,
		`{"schemaVersion":2,"recordId":"rec_parallel_b","type":"run:resume","runId":"run_parallel","traceId":"22222222222222222222222222222222","segmentId":"seg_parallel_b","segmentSeq":1,"resumedAt":"2026-05-16T18:00:02.000Z","reason":"branch-b","previousSegmentId":"seg_parallel_root"}`,
	)); err != nil {
		t.Fatal(err)
	}
	run, err := service.Run(ctx, "run_parallel")
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "running" || run.SegmentCount != 3 || run.ActiveSegmentID != "" || run.OrderingConfidence != "partial" {
		t.Fatalf("concurrent run projection = %#v", run)
	}
}

func TestServiceSurfacesMissingParentAndSequenceGaps(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_gap_start","type":"run:start","runId":"run_gap","traceId":"33333333333333333333333333333333","segmentId":"seg_gap","segmentSeq":1,"name":"gap","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_gap_child","type":"span:start","runId":"run_gap","traceId":"33333333333333333333333333333333","segmentId":"seg_gap","segmentSeq":3,"spanId":"3333333333333333","parentSpanId":"4444444444444444","family":"agent","primitive":"agent.run","name":"child","startedAt":"2026-05-16T18:00:01.000Z","status":"running"}`,
	)); err != nil {
		t.Fatal(err)
	}
	run, err := service.Run(ctx, "run_gap")
	if err != nil {
		t.Fatal(err)
	}
	if run.GapCount != 2 || run.OrderingConfidence != "partial" {
		t.Fatalf("gap projection = %#v, want one sequence and one parent gap", run)
	}
}

func TestServiceSurfacesMissingPreviousSegmentAsGap(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_missing_segment_resume","type":"run:resume","runId":"run_missing_segment","traceId":"35353535353535353535353535353535","segmentId":"seg_missing_segment_b","segmentSeq":1,"resumedAt":"2026-05-16T18:00:00.000Z","reason":"replay","previousSegmentId":"seg_missing_segment_a"}`,
	)); err != nil {
		t.Fatal(err)
	}
	run, err := service.Run(ctx, "run_missing_segment")
	if err != nil {
		t.Fatal(err)
	}
	if run.GapCount != 1 || run.OrderingConfidence != "partial" {
		t.Fatalf("missing segment projection = %#v", run)
	}
}

func TestServiceConflictsWhenTerminalRunIsResumedInAnotherSegment(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_terminal_resume_start","type":"run:start","runId":"run_terminal_resume","traceId":"36363636363636363636363636363636","segmentId":"seg_terminal_resume_a","segmentSeq":1,"name":"terminal","rootPrimitive":"flow.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_terminal_resume_end","type":"run:end","runId":"run_terminal_resume","traceId":"36363636363636363636363636363636","segmentId":"seg_terminal_resume_a","segmentSeq":2,"endedAt":"2026-05-16T18:00:01.000Z","status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_terminal_resume_late","type":"run:resume","runId":"run_terminal_resume","traceId":"36363636363636363636363636363636","segmentId":"seg_terminal_resume_b","segmentSeq":1,"resumedAt":"2026-05-16T18:00:02.000Z","reason":"late","previousSegmentId":"seg_terminal_resume_a"}`,
	)); err != nil {
		t.Fatal(err)
	}
	run, err := service.Run(ctx, "run_terminal_resume")
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "conflicted" {
		t.Fatalf("terminal-resume projection = %#v", run)
	}
}

func TestServiceCompletedThreeSegmentMultiSuspendRunIsNotConflicted(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_multi_suspend_start","type":"run:start","runId":"run_multi_suspend","traceId":"37373737373737373737373737373737","segmentId":"seg_multi_suspend_a","segmentSeq":1,"name":"multi","rootPrimitive":"flow.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_multi_suspend_a_suspend","type":"run:suspend","runId":"run_multi_suspend","traceId":"37373737373737373737373737373737","segmentId":"seg_multi_suspend_a","segmentSeq":2,"suspendedAt":"2026-05-16T18:00:01.000Z","reason":"plan-approval"}`,
		`{"schemaVersion":2,"recordId":"rec_multi_suspend_b_resume","type":"run:resume","runId":"run_multi_suspend","traceId":"37373737373737373737373737373737","segmentId":"seg_multi_suspend_b","segmentSeq":1,"resumedAt":"2026-05-16T18:00:02.000Z","reason":"plan-approval","previousSegmentId":"seg_multi_suspend_a"}`,
		`{"schemaVersion":2,"recordId":"rec_multi_suspend_b_suspend","type":"run:suspend","runId":"run_multi_suspend","traceId":"37373737373737373737373737373737","segmentId":"seg_multi_suspend_b","segmentSeq":2,"suspendedAt":"2026-05-16T18:00:03.000Z","reason":"content-review"}`,
		`{"schemaVersion":2,"recordId":"rec_multi_suspend_c_resume","type":"run:resume","runId":"run_multi_suspend","traceId":"37373737373737373737373737373737","segmentId":"seg_multi_suspend_c","segmentSeq":1,"resumedAt":"2026-05-16T18:00:04.000Z","reason":"content-review","previousSegmentId":"seg_multi_suspend_b"}`,
		`{"schemaVersion":2,"recordId":"rec_multi_suspend_c_end","type":"run:end","runId":"run_multi_suspend","traceId":"37373737373737373737373737373737","segmentId":"seg_multi_suspend_c","segmentSeq":2,"endedAt":"2026-05-16T18:00:05.000Z","status":"ok"}`,
	)); err != nil {
		t.Fatal(err)
	}
	run, err := service.Run(ctx, "run_multi_suspend")
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "ok" || run.SegmentCount != 3 {
		t.Fatalf("multi-suspend completed projection = %#v, want status ok across 3 segments", run)
	}
}

func TestProjectRunDetailDistinguishesIncompleteSuspendedAndTerminal(t *testing.T) {
	started := time.Date(2026, 5, 16, 18, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		name string
		run  RunSummary
		want string
	}{
		{name: "stale incomplete", run: RunSummary{Status: "running", StartedAt: started.Format(time.RFC3339Nano)}, want: "incomplete"},
		{name: "suspended", run: RunSummary{Status: "suspended", StartedAt: started.Format(time.RFC3339Nano)}, want: "suspended"},
		{name: "terminal", run: RunSummary{Status: "ok", StartedAt: started.Format(time.RFC3339Nano), EndedAt: started.Add(time.Second).Format(time.RFC3339Nano)}, want: "ok"},
	} {
		t.Run(test.name, func(t *testing.T) {
			detail := ProjectRunDetail(Graph{Run: test.run}, ProjectionOptions{Now: started.Add(2 * time.Minute)})
			if detail.Run.Status != test.want {
				t.Fatalf("status = %q, want %q", detail.Run.Status, test.want)
			}
		})
	}
}

func TestServiceDiagnosesConflictingDuplicateTerminal(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_terminal_start_v2","type":"run:start","runId":"run_terminal_conflict","traceId":"44444444444444444444444444444444","segmentId":"seg_terminal_conflict","segmentSeq":1,"name":"terminal","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_terminal_ok_v2","type":"run:end","runId":"run_terminal_conflict","traceId":"44444444444444444444444444444444","segmentId":"seg_terminal_conflict","segmentSeq":2,"endedAt":"2026-05-16T18:00:01.000Z","status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_terminal_error_v2","type":"run:end","runId":"run_terminal_conflict","traceId":"44444444444444444444444444444444","segmentId":"seg_terminal_conflict","segmentSeq":3,"endedAt":"2026-05-16T18:00:02.000Z","status":"error","error":{"message":"late"}}`,
	)); err != nil {
		t.Fatal(err)
	}
	run, err := service.Run(ctx, "run_terminal_conflict")
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "conflicted" || run.EndedAt != "2026-05-16T18:00:01.000Z" {
		t.Fatalf("terminal conflict projection = %#v", run)
	}
}

func assertSegmentProjection(t *testing.T, service *Service, segmentID, status, resumedAt, suspendedAt, reason, previousSegmentID string) {
	t.Helper()
	var gotStatus, gotResumedAt, gotSuspendedAt, gotReason, gotPrevious string
	if err := service.db.QueryRow(`
		SELECT ifnull(status, ''), ifnull(resumed_at, ''), ifnull(suspended_at, ''), ifnull(reason, ''), ifnull(previous_segment_id, '')
		FROM run_segments WHERE segment_id = ?
	`, segmentID).Scan(&gotStatus, &gotResumedAt, &gotSuspendedAt, &gotReason, &gotPrevious); err != nil {
		t.Fatal(err)
	}
	if gotStatus != status || gotResumedAt != resumedAt || gotSuspendedAt != suspendedAt || gotReason != reason || gotPrevious != previousSegmentID {
		t.Fatalf("segment %s = %q/%q/%q/%q/%q", segmentID, gotStatus, gotResumedAt, gotSuspendedAt, gotReason, gotPrevious)
	}
}
