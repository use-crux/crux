package observability

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"
)

const (
	runDetailTokenChunkBudget = 50 * time.Millisecond
	listRunsRollupBudget      = 20 * time.Millisecond
	ingestBatchBudget         = 100 * time.Millisecond
	reconcilerTickBudget      = 5 * time.Millisecond
)

func BenchmarkServiceRunDetailExcludesTokenChunks(b *testing.B) {
	ctx := context.Background()
	service := newBenchmarkService(b)
	runID := seedRunDetailTokenChunks(b, service, 10_000)

	b.ResetTimer()
	start := time.Now()
	for i := 0; i < b.N; i++ {
		if _, err := service.RunDetail(ctx, runID); err != nil {
			b.Fatal(err)
		}
	}
	assertBenchmarkBudget(b, time.Since(start), runDetailTokenChunkBudget)
}

func BenchmarkServiceListRunsUsesRollupColumns(b *testing.B) {
	ctx := context.Background()
	service := newBenchmarkService(b)
	seedRunListRollups(b, service, 2_000)

	b.ResetTimer()
	start := time.Now()
	for i := 0; i < b.N; i++ {
		runs, err := service.RunsWithOptions(ctx, RunListOptions{
			Limit:                   100,
			IncludeExpensiveRollups: false,
		})
		if err != nil {
			b.Fatal(err)
		}
		if len(runs) != 100 {
			b.Fatalf("runs len = %d, want 100", len(runs))
		}
	}
	assertBenchmarkBudget(b, time.Since(start), listRunsRollupBudget)
}

func BenchmarkServiceIngestPreparedBatch(b *testing.B) {
	ctx := context.Background()
	service := newBenchmarkService(b)

	b.ResetTimer()
	var elapsed time.Duration
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		batch := benchmarkIngestBatch(b, i)
		b.StartTimer()
		start := time.Now()
		if err := service.Ingest(ctx, batch); err != nil {
			b.Fatal(err)
		}
		elapsed += time.Since(start)
	}
	assertBenchmarkBudget(b, elapsed, ingestBatchBudget)
}

func BenchmarkServiceLifecycleReconcilerSkipsMarkedRuns(b *testing.B) {
	ctx := context.Background()
	service := newBenchmarkService(b)
	seedReconciledLifecycleRuns(b, service, 50)

	b.ResetTimer()
	start := time.Now()
	for i := 0; i < b.N; i++ {
		if err := service.PublishLifecycleReconciliations(ctx); err != nil {
			b.Fatal(err)
		}
	}
	assertBenchmarkBudget(b, time.Since(start), reconcilerTickBudget)
}

func BenchmarkScaleStoreReadPaths(b *testing.B) {
	path := os.Getenv("CRUX_SCALE_DB")
	if path == "" {
		b.Skip("CRUX_SCALE_DB is not set")
	}
	ctx := context.Background()
	service, err := OpenService(ctx, path)
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() {
		if err := service.Close(); err != nil {
			b.Fatal(err)
		}
	})

	bench := func(name string, fn func() error) {
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				if err := fn(); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
	bench("page", func() error {
		_, err := service.RunsPage(ctx, RunListOptions{Limit: 100})
		return err
	})
	bench("failures", func() error {
		_, err := service.RunsPage(ctx, RunListOptions{Limit: 100, Status: []string{"error", "failed", "fail"}})
		return err
	})
	bench("all-cheap", func() error {
		_, err := service.RunsWithOptions(ctx, RunListOptions{Limit: -1})
		return err
	})
	bench("all-enriched", func() error {
		_, err := service.RunsWithOptions(ctx, RunListOptions{Limit: -1, IncludeExpensiveRollups: true})
		return err
	})
	bench("summary-snapshot", func() error {
		_, err := service.RunSummarySnapshot(ctx)
		return err
	})
	bench("big-detail", func() error {
		_, err := service.RunDetail(ctx, "run_scale_big_200spans")
		return err
	})
}

func TestRunSummarySnapshotUsesFullHistoryAndRevisionInvalidation(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < DefaultRunListLimit+1; i++ {
		runID := fmt.Sprintf("snapshot-%03d", i)
		startedAt := fmt.Sprintf("2026-05-16T18:%02d:%02d.000Z", (i/60)%60, i%60)
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO operations (operation_id, first_seen_at, root_present)
			VALUES (?, ?, 1)
		`, runID, startedAt); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO runs (
				run_id, operation_id, trace_id, name, root_primitive, status,
				started_at, ended_at, total_input_tokens, total_output_tokens,
				total_cost_usd, last_activity_at
			) VALUES (?, ?, ?, 'snapshot', 'agent.run', 'ok', ?, ?, 1, 1, 0.01, ?)
		`, runID, runID, "trace-"+runID, startedAt, startedAt, startedAt); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	first, err := service.RunSummarySnapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := len(first), DefaultRunListLimit+1; got != want {
		t.Fatalf("snapshot rows = %d, want full history %d", got, want)
	}
	originalMetrics := append(json.RawMessage(nil), first[0].Metrics...)
	if len(first[0].Metrics) == 0 {
		t.Fatal("snapshot fixture did not project metrics")
	}
	first[0].Metrics[0] ^= 0xff
	isolated, err := service.RunSummarySnapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(isolated[0].Metrics, originalMetrics) {
		t.Fatal("caller mutation leaked into the summary snapshot cache")
	}

	ingestRunStart(t, service, "snapshot-new", "snapshot-new-segment", "snapshot-new-trace", "running", "2026-05-16T20:00:00.000Z")
	second, err := service.RunSummarySnapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := len(second), DefaultRunListLimit+2; got != want {
		t.Fatalf("snapshot after revision = %d, want %d", got, want)
	}
}

func newBenchmarkService(b *testing.B) *Service {
	b.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() {
		if err := db.Close(); err != nil {
			b.Fatal(err)
		}
	})
	service, err := NewService(db)
	if err != nil {
		b.Fatal(err)
	}
	return service
}

func seedRunDetailTokenChunks(b *testing.B, service *Service, count int) string {
	b.Helper()
	ctx := context.Background()
	runID := "run_bench_token_chunks"
	traceID := "trace_bench_token_chunks"
	spanID := "span_bench_token_chunks"
	mustExecBenchmark(b, service.db, `
		INSERT INTO runs (
			run_id, trace_id, name, root_primitive, status, started_at,
			span_count, event_count, record_count, last_activity_at
		)
		VALUES (?, ?, 'token chunks', 'generation.stream', 'running', ?, 1, ?, ?, ?)
	`, runID, traceID, benchmarkTimestamp(0), count, count+2, benchmarkTimestamp(count))
	mustExecBenchmark(b, service.db, `
		INSERT INTO spans (
			span_id, run_id, trace_id, family, primitive, name, status, started_at, attributes_json
		)
		VALUES (?, ?, ?, 'generation', 'generation.stream', 'stream', 'running', ?, '{}')
	`, spanID, runID, traceID, benchmarkTimestamp(1))

	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		b.Fatal(err)
	}
	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO span_events (event_id, run_id, trace_id, span_id, name, timestamp, attributes_json)
		VALUES (?, ?, ?, ?, 'token.chunk', ?, ?)
	`)
	if err != nil {
		b.Fatal(err)
	}
	for i := 0; i < count; i++ {
		attrs := fmt.Sprintf(`{"chunkIndex":%d,"charCount":1,"text":"x"}`, i)
		if _, err := stmt.ExecContext(ctx, fmt.Sprintf("event_bench_token_%05d", i), runID, traceID, spanID, benchmarkTimestamp(i), attrs); err != nil {
			_ = stmt.Close()
			_ = tx.Rollback()
			b.Fatal(err)
		}
	}
	if err := stmt.Close(); err != nil {
		_ = tx.Rollback()
		b.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		b.Fatal(err)
	}
	return runID
}

func seedRunListRollups(b *testing.B, service *Service, count int) {
	b.Helper()
	ctx := context.Background()
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		b.Fatal(err)
	}
	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO runs (
			run_id, trace_id, name, root_primitive, status, started_at, ended_at,
			duration_ms, span_count, event_count, artifact_count, edge_count,
			record_count, total_input_tokens, total_output_tokens, total_cost_usd,
			last_activity_at
		)
		VALUES (?, ?, 'bench run', 'agent.run', 'ok', ?, ?, 10, 1, 2, 3, 4, 10, ?, ?, ?, ?)
	`)
	if err != nil {
		b.Fatal(err)
	}
	for i := 0; i < count; i++ {
		runID := fmt.Sprintf("run_bench_list_%04d", i)
		timestamp := benchmarkTimestamp(i)
		if _, err := stmt.ExecContext(ctx, runID, "trace_"+runID, timestamp, timestamp, i, i*2, float64(i)/100, timestamp); err != nil {
			_ = stmt.Close()
			_ = tx.Rollback()
			b.Fatal(err)
		}
	}
	if err := stmt.Close(); err != nil {
		_ = tx.Rollback()
		b.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		b.Fatal(err)
	}
}

func seedReconciledLifecycleRuns(b *testing.B, service *Service, count int) {
	b.Helper()
	ctx := context.Background()
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		b.Fatal(err)
	}
	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO runs (
			run_id, trace_id, name, root_primitive, status, started_at,
			last_activity_at, lifecycle_status, lifecycle_checked_at
		)
		VALUES (?, ?, 'stale marked', 'agent.run', 'running', ?, ?, 'reconciled-stale', ?)
	`)
	if err != nil {
		b.Fatal(err)
	}
	for i := 0; i < count; i++ {
		runID := fmt.Sprintf("run_bench_reconciled_%02d", i)
		timestamp := benchmarkTimestamp(i)
		if _, err := stmt.ExecContext(ctx, runID, "trace_"+runID, timestamp, timestamp, timestamp); err != nil {
			_ = stmt.Close()
			_ = tx.Rollback()
			b.Fatal(err)
		}
	}
	if err := stmt.Close(); err != nil {
		_ = tx.Rollback()
		b.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		b.Fatal(err)
	}
}

func benchmarkIngestBatch(b *testing.B, iteration int) Batch {
	b.Helper()
	runID := fmt.Sprintf("run_bench_ingest_%06d", iteration)
	segmentID := fmt.Sprintf("seg_bench_ingest_%06d_a", iteration)
	traceID := fmt.Sprintf("trace_bench_ingest_%06d", iteration)
	spanID := fmt.Sprintf("span_bench_ingest_%06d", iteration)
	records := []string{
		fmt.Sprintf(`{"schemaVersion":2,"recordId":"%s_start","segmentSeq":1,"type":"run:start","runId":%q,"segmentId":%q,"traceId":%q,"name":"ingest","rootPrimitive":"generation.stream","startedAt":%q,"status":"running"}`, runID, runID, segmentID, traceID, benchmarkTimestamp(iteration)),
		fmt.Sprintf(`{"schemaVersion":2,"recordId":"%s_span","segmentSeq":2,"type":"span","runId":%q,"segmentId":%q,"traceId":%q,"spanId":%q,"family":"generation","primitive":"generation.stream","name":"stream","startedAt":%q,"endedAt":%q,"durationMs":10,"status":"ok","metrics":{"inputTokens":1,"outputTokens":2,"costUsd":0.001}}`, runID, runID, segmentID, traceID, spanID, benchmarkTimestamp(iteration), benchmarkTimestamp(iteration+1)),
	}
	for i := 0; i < 509; i++ {
		records = append(records, fmt.Sprintf(`{"schemaVersion":2,"recordId":"%s_event_%03d","segmentSeq":%d,"type":"span:event","runId":%q,"segmentId":%q,"traceId":%q,"spanId":%q,"eventId":"event_%s_%03d","name":"usage.observed","timestamp":%q,"attributes":{"inputTokens":1,"outputTokens":1,"cost":0.001}}`, runID, i, i+3, runID, segmentID, traceID, spanID, runID, i, benchmarkTimestamp(iteration+i)))
	}
	records = append(records, fmt.Sprintf(`{"schemaVersion":2,"recordId":"%s_end","segmentSeq":512,"type":"run:end","runId":%q,"segmentId":%q,"traceId":%q,"endedAt":%q,"durationMs":20,"status":"ok"}`, runID, runID, segmentID, traceID, benchmarkTimestamp(iteration+2)))
	return mustBenchmarkBatch(b, records...)
}

func mustBenchmarkBatch(b *testing.B, records ...string) Batch {
	b.Helper()
	batch := Batch{Records: make([]Record, 0, len(records))}
	for _, raw := range records {
		var record Record
		if err := json.Unmarshal([]byte(raw), &record); err != nil {
			b.Fatal(err)
		}
		batch.Records = append(batch.Records, record)
	}
	return batch
}

func benchmarkTimestamp(offset int) string {
	return time.Date(2026, 5, 16, 18, 0, 0, 0, time.UTC).
		Add(time.Duration(offset) * time.Millisecond).
		Format(time.RFC3339Nano)
}

func mustExecBenchmark(b *testing.B, db *sql.DB, query string, args ...any) {
	b.Helper()
	if _, err := db.ExecContext(context.Background(), query, args...); err != nil {
		b.Fatal(err)
	}
}

func assertBenchmarkBudget(b *testing.B, elapsed time.Duration, budget time.Duration) {
	b.Helper()
	iterations := b.N
	if iterations <= 0 {
		iterations = 1
	}
	perOperation := elapsed / time.Duration(iterations)
	b.ReportMetric(float64(perOperation.Microseconds()), "budgeted_us/op")
	if perOperation > budget {
		b.Fatalf("average operation took %s, budget is %s", perOperation, budget)
	}
}
