package observability

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
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
	traceID := fmt.Sprintf("trace_bench_ingest_%06d", iteration)
	spanID := fmt.Sprintf("span_bench_ingest_%06d", iteration)
	records := []string{
		fmt.Sprintf(`{"schemaVersion":1,"recordId":"%s_start","seq":1,"type":"run:start","runId":%q,"traceId":%q,"name":"ingest","rootPrimitive":"generation.stream","startedAt":%q,"status":"running"}`, runID, runID, traceID, benchmarkTimestamp(iteration)),
		fmt.Sprintf(`{"schemaVersion":1,"recordId":"%s_span","seq":2,"type":"span","runId":%q,"traceId":%q,"spanId":%q,"family":"generation","primitive":"generation.stream","name":"stream","startedAt":%q,"endedAt":%q,"durationMs":10,"status":"ok","metrics":{"inputTokens":1,"outputTokens":2,"costUsd":0.001}}`, runID, runID, traceID, spanID, benchmarkTimestamp(iteration), benchmarkTimestamp(iteration+1)),
	}
	for i := 0; i < 509; i++ {
		records = append(records, fmt.Sprintf(`{"schemaVersion":1,"recordId":"%s_event_%03d","seq":%d,"type":"span:event","runId":%q,"traceId":%q,"spanId":%q,"eventId":"event_%s_%03d","name":"usage.observed","timestamp":%q,"attributes":{"inputTokens":1,"outputTokens":1,"cost":0.001}}`, runID, i, i+3, runID, traceID, spanID, runID, i, benchmarkTimestamp(iteration+i)))
	}
	records = append(records, fmt.Sprintf(`{"schemaVersion":1,"recordId":"%s_end","seq":512,"type":"run:end","runId":%q,"traceId":%q,"endedAt":%q,"durationMs":20,"status":"ok"}`, runID, runID, traceID, benchmarkTimestamp(iteration+2)))
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
