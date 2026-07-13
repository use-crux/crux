package observability

import (
	"context"
	"database/sql"
	"testing"
)

func TestServiceMigratesPhase15RollupSchema(t *testing.T) {
	service := newTestService(t)

	for _, column := range []string{
		"span_count",
		"event_count",
		"artifact_count",
		"edge_count",
		"record_count",
		"total_input_tokens",
		"total_output_tokens",
		"total_cost_usd",
		"last_activity_at",
		"lifecycle_status",
		"lifecycle_checked_at",
	} {
		assertSQLiteColumn(t, service.db, "runs", column)
	}
	assertSQLiteColumn(t, service.db, "records", "segment_id")
	assertSQLiteColumn(t, service.db, "records", "segment_seq")

	for _, index := range []string{
		"idx_runs_session",
		"idx_spans_status",
		"idx_spans_family_started",
		"idx_artifacts_span",
		"idx_edges_from",
		"idx_edges_to",
	} {
		assertSQLiteIndex(t, service.db, index)
	}

	var autoVacuum int
	if err := service.db.QueryRow(`PRAGMA auto_vacuum`).Scan(&autoVacuum); err != nil {
		t.Fatal(err)
	}
	if autoVacuum != 2 {
		t.Fatalf("auto_vacuum = %d, want INCREMENTAL(2)", autoVacuum)
	}
}

func TestServiceMaintainsRunRollupsDuringIngest(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	batch := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_rollup_end","segmentSeq":6,"type":"run:end","runId":"run_ingest_rollups","segmentId":"seg_ingest_rollups_a","traceId":"trace_ingest_rollups","endedAt":"2026-05-16T18:00:01.000Z","durationMs":1000,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_rollup_event","segmentSeq":4,"type":"span:event","runId":"run_ingest_rollups","segmentId":"seg_ingest_rollups_a","traceId":"trace_ingest_rollups","spanId":"span_ingest_rollups","eventId":"evt_rollup_usage","name":"usage.observed","timestamp":"2026-05-16T18:00:00.800Z","attributes":{"inputTokens":3,"outputTokens":4,"cost":0.005}}`,
		`{"schemaVersion":2,"recordId":"rec_rollup_start","segmentSeq":1,"type":"run:start","runId":"run_ingest_rollups","segmentId":"seg_ingest_rollups_a","traceId":"trace_ingest_rollups","name":"rollups","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_rollup_span","segmentSeq":2,"type":"span","runId":"run_ingest_rollups","segmentId":"seg_ingest_rollups_a","traceId":"trace_ingest_rollups","spanId":"span_ingest_rollups","family":"generation","primitive":"generation.call","name":"generate","startedAt":"2026-05-16T18:00:00.100Z","endedAt":"2026-05-16T18:00:00.900Z","durationMs":800,"status":"ok","metrics":{"inputTokens":10,"outputTokens":12,"costUsd":0.02}}`,
		`{"schemaVersion":2,"recordId":"rec_rollup_artifact","segmentSeq":3,"type":"artifact","runId":"run_ingest_rollups","segmentId":"seg_ingest_rollups_a","traceId":"trace_ingest_rollups","spanId":"span_ingest_rollups","artifactId":"artifact_rollup","kind":"output","createdAt":"2026-05-16T18:00:00.700Z","contentType":"application/json","encoding":"reference","sizeBytes":42}`,
		`{"schemaVersion":2,"recordId":"rec_rollup_edge","segmentSeq":5,"type":"edge","runId":"run_ingest_rollups","segmentId":"seg_ingest_rollups_a","traceId":"trace_ingest_rollups","edgeId":"edge_rollup","edgeType":"produced","from":{"kind":"span","id":"span_ingest_rollups"},"to":{"kind":"artifact","id":"artifact_rollup"},"createdAt":"2026-05-16T18:00:00.710Z"}`,
		`{"schemaVersion":2,"recordId":"rec_rollup_span_metrics","segmentSeq":7,"type":"span","runId":"run_ingest_rollups","segmentId":"seg_ingest_rollups_a","traceId":"trace_ingest_rollups","spanId":"span_ingest_rollups_metrics","family":"generation","primitive":"generation.call","name":"generate metrics","startedAt":"2026-05-16T18:00:00.200Z","endedAt":"2026-05-16T18:00:00.950Z","durationMs":750,"status":"ok","metrics":{"inputTokens":10,"outputTokens":12,"costUsd":0.02}}`,
	)

	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}
	if err := service.Ingest(ctx, batch); err != nil {
		t.Fatal(err)
	}

	var stored struct {
		recordCount       int
		spanCount         int
		eventCount        int
		artifactCount     int
		edgeCount         int
		totalInputTokens  int
		totalOutputTokens int
		totalCostUSD      float64
		lastActivityAt    string
	}
	if err := service.db.QueryRow(`
		SELECT record_count, span_count, event_count, artifact_count, edge_count,
			total_input_tokens, total_output_tokens, total_cost_usd, ifnull(last_activity_at, '')
		FROM runs
		WHERE run_id = ?
	`, "run_ingest_rollups").Scan(
		&stored.recordCount,
		&stored.spanCount,
		&stored.eventCount,
		&stored.artifactCount,
		&stored.edgeCount,
		&stored.totalInputTokens,
		&stored.totalOutputTokens,
		&stored.totalCostUSD,
		&stored.lastActivityAt,
	); err != nil {
		t.Fatal(err)
	}

	if stored.recordCount != 7 || stored.spanCount != 2 || stored.eventCount != 1 || stored.artifactCount != 1 || stored.edgeCount != 1 {
		t.Fatalf("stored counts = records:%d spans:%d events:%d artifacts:%d edges:%d", stored.recordCount, stored.spanCount, stored.eventCount, stored.artifactCount, stored.edgeCount)
	}
	if stored.totalInputTokens != 13 || stored.totalOutputTokens != 16 || stored.totalCostUSD != 0.025 {
		t.Fatalf("stored usage = input:%d output:%d cost:%f", stored.totalInputTokens, stored.totalOutputTokens, stored.totalCostUSD)
	}
	if stored.lastActivityAt != "2026-05-16T18:00:01.000Z" {
		t.Fatalf("last_activity_at = %q", stored.lastActivityAt)
	}

	runs, err := service.RunsWithOptions(ctx, RunListOptions{Limit: -1, IncludeExpensiveRollups: false})
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 {
		t.Fatalf("runs = %#v", runs)
	}
	run := runs[0]
	if run.RecordCount != 7 || run.SpanCount != 2 || run.EventCount != 1 || run.ArtifactCount != 1 || run.EdgeCount != 1 {
		t.Fatalf("cheap run counts = records:%d spans:%d events:%d artifacts:%d edges:%d", run.RecordCount, run.SpanCount, run.EventCount, run.ArtifactCount, run.EdgeCount)
	}
	metrics := numericMetricsFromRaw(run.Metrics)
	if metrics["inputTokens"] != 13 || metrics["outputTokens"] != 16 || metrics["totalTokens"] != 29 || metrics["costUsd"] != 0.025 {
		t.Fatalf("cheap run metrics = %#v", metrics)
	}
}

func TestServiceRollupsReserveRunRowsForOutOfOrderRecords(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)

	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_orphan_span","segmentSeq":1,"type":"span","runId":"run_orphan_rollup","segmentId":"seg_orphan_rollup_a","traceId":"trace_orphan_rollup","spanId":"span_orphan_rollup","family":"generation","primitive":"generation.call","name":"generate","startedAt":"2026-05-16T18:00:00.100Z","endedAt":"2026-05-16T18:00:00.900Z","durationMs":800,"status":"ok","metrics":{"inputTokens":4,"outputTokens":5,"costUsd":0.01}}`,
	)); err != nil {
		t.Fatal(err)
	}

	var recordCount, spanCount, inputTokens, outputTokens int
	if err := service.db.QueryRow(`
		SELECT record_count, span_count, total_input_tokens, total_output_tokens
		FROM runs
		WHERE run_id = ?
	`, "run_orphan_rollup").Scan(&recordCount, &spanCount, &inputTokens, &outputTokens); err != nil {
		t.Fatal(err)
	}
	if recordCount != 1 || spanCount != 1 || inputTokens != 4 || outputTokens != 5 {
		t.Fatalf("reserved rollups = records:%d spans:%d input:%d output:%d", recordCount, spanCount, inputTokens, outputTokens)
	}
}

func assertSQLiteColumn(t *testing.T, db *sql.DB, table string, column string) {
	t.Helper()
	rows, err := db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			t.Fatal(err)
		}
		if name == column {
			return
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	t.Fatalf("missing %s.%s column", table, column)
}

func assertSQLiteIndex(t *testing.T, db *sql.DB, index string) {
	t.Helper()
	var name string
	if err := db.QueryRow(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`, index).Scan(&name); err != nil {
		t.Fatalf("missing index %s: %v", index, err)
	}
}
