package observability

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestServiceRollsBackFailedPreV2ResetAndCanReopen(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "observability.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		CREATE TABLE records (
			record_id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			trace_id TEXT,
			seq INTEGER NOT NULL DEFAULT 0,
			type TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		INSERT INTO records (record_id, run_id, trace_id, seq, type, payload_json)
		VALUES ('rec_pre_v2_rollback', 'run_pre_v2_rollback', 'trace_pre_v2_rollback', 7, 'run:start', '{"schemaVersion":1,"recordId":"rec_pre_v2_rollback","type":"run:start","runId":"run_pre_v2_rollback","traceId":"trace_pre_v2_rollback","seq":7,"name":"pre-v2","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}');
		CREATE TABLE app_data (id TEXT PRIMARY KEY, value TEXT NOT NULL);
		INSERT INTO app_data (id, value) VALUES ('keep', 'unrelated');
	`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	injected := errors.New("injected migration failure")
	failedDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	failedService := &Service{db: failedDB}
	err = failedService.migrateWithHook(ctx, func(step string) error {
		if step == "after-contract-reset" {
			return injected
		}
		return nil
	})
	if !errors.Is(err, injected) {
		t.Fatalf("migrate error = %v, want injected migration failure", err)
	}
	if err := failedDB.Close(); err != nil {
		t.Fatal(err)
	}

	inspectDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	var preV2Count int
	if err := inspectDB.QueryRowContext(ctx, `SELECT count(*) FROM records WHERE record_id = 'rec_pre_v2_rollback'`).Scan(&preV2Count); err != nil {
		t.Fatal(err)
	}
	if preV2Count != 1 {
		t.Fatalf("pre-v2 records after failed migration = %d, want rollback to keep 1", preV2Count)
	}
	var appValue string
	if err := inspectDB.QueryRowContext(ctx, `SELECT value FROM app_data WHERE id = 'keep'`).Scan(&appValue); err != nil {
		t.Fatal(err)
	}
	if appValue != "unrelated" {
		t.Fatalf("app_data after failed migration = %q, want unrelated", appValue)
	}
	if err := inspectDB.Close(); err != nil {
		t.Fatal(err)
	}

	reopenedDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(reopenedDB)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := reopenedDB.Close(); err != nil {
			t.Fatal(err)
		}
	})
	records, err := service.listRecords(ctx, "run_pre_v2_rollback")
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 0 {
		t.Fatalf("records after successful reopen = %#v, want pre-v2 observability reset", records)
	}
	if err := service.db.QueryRowContext(ctx, `SELECT value FROM app_data WHERE id = 'keep'`).Scan(&appValue); err != nil {
		t.Fatal(err)
	}
	if appValue != "unrelated" {
		t.Fatalf("app_data after successful migration = %q, want unrelated", appValue)
	}
}

func TestServiceMigratesPreV2ObservabilityRowsByResettingOnlyObservabilityTables(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatal(err)
		}
	})
	if _, err := db.Exec(`
		CREATE TABLE records (
			record_id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			trace_id TEXT,
			seq INTEGER NOT NULL DEFAULT 0,
			type TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		INSERT INTO records (record_id, run_id, trace_id, seq, type, payload_json)
		VALUES ('rec_pre_v2', 'run_pre_v2', 'trace_pre_v2', 7, 'run:start', '{"schemaVersion":1,"recordId":"rec_pre_v2","type":"run:start","runId":"run_pre_v2","traceId":"trace_pre_v2","seq":7,"name":"pre-v2","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}');
		CREATE TABLE app_data (id TEXT PRIMARY KEY, value TEXT NOT NULL);
		INSERT INTO app_data (id, value) VALUES ('keep', 'unrelated');
	`); err != nil {
		t.Fatal(err)
	}

	service, err := NewService(db)
	if err != nil {
		t.Fatal(err)
	}

	records, err := service.listRecords(ctx, "run_pre_v2")
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 0 {
		t.Fatalf("records = %#v, want pre-v2 observability rows removed", records)
	}
	var value string
	if err := service.db.QueryRowContext(ctx, `SELECT value FROM app_data WHERE id = 'keep'`).Scan(&value); err != nil {
		t.Fatal(err)
	}
	if value != "unrelated" {
		t.Fatalf("app_data value = %q, want unrelated", value)
	}
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_after_reset_start","type":"run:start","runId":"run_after_reset","traceId":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","segmentId":"seg_after_reset_a","segmentSeq":1,"name":"after reset","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
	)); err != nil {
		t.Fatal(err)
	}
	records, err = service.listRecords(ctx, "run_after_reset")
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].SegmentID != "seg_after_reset_a" || records[0].SegmentSeq != 1 {
		t.Fatalf("v2 records after reset = %#v", records)
	}
}

func TestServiceRepeatedReopenPreservesCompleteV2Schema(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "observability.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_reopen_start","type":"run:start","runId":"run_reopen","traceId":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","segmentId":"seg_reopen_a","segmentSeq":1,"name":"reopen","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
	)); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	reopenedDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := NewService(reopenedDB)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := reopenedDB.Close(); err != nil {
			t.Fatal(err)
		}
	})
	records, err := reopened.listRecords(ctx, "run_reopen")
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].RecordID != "rec_reopen_start" {
		t.Fatalf("records after repeated reopen = %#v, want existing v2 record preserved", records)
	}
}

func TestServiceResetsIncompleteV2RunSegmentsSchema(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatal(err)
		}
	})
	if _, err := db.Exec(`
		CREATE TABLE records (
			record_id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			trace_id TEXT,
			segment_id TEXT NOT NULL,
			segment_seq INTEGER NOT NULL,
			type TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE UNIQUE INDEX idx_records_segment_seq_unique ON records(segment_id, segment_seq);
		INSERT INTO records (record_id, run_id, trace_id, segment_id, segment_seq, type, payload_json)
		VALUES ('rec_incomplete_v2', 'run_incomplete_v2', 'trace_incomplete_v2', 'seg_incomplete_v2_a', 1, 'run:start', '{"schemaVersion":2,"recordId":"rec_incomplete_v2","type":"run:start","runId":"run_incomplete_v2","traceId":"trace_incomplete_v2","segmentId":"seg_incomplete_v2_a","segmentSeq":1,"name":"incomplete v2","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}');
		CREATE TABLE run_segments (
			run_id TEXT NOT NULL,
			segment_id TEXT NOT NULL,
			first_segment_seq INTEGER NOT NULL DEFAULT 0,
			last_segment_seq INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (run_id, segment_id)
		);
		INSERT INTO run_segments (run_id, segment_id, first_segment_seq, last_segment_seq)
		VALUES ('run_incomplete_v2', 'seg_incomplete_v2_a', 1, 1);
	`); err != nil {
		t.Fatal(err)
	}
	service, err := NewService(db)
	if err != nil {
		t.Fatal(err)
	}
	records, err := service.listRecords(ctx, "run_incomplete_v2")
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 0 {
		t.Fatalf("records after incomplete v2 schema reset = %#v, want reset", records)
	}
	assertRunSegmentsPrimaryKey(t, service.db, []string{"segment_id"})
}

func TestServiceResetsPartialV2RecordsSchemaMissingRequiredColumn(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatal(err)
		}
	})
	if _, err := db.Exec(`
		CREATE TABLE records (
			record_id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			trace_id TEXT,
			segment_id TEXT NOT NULL,
			segment_seq INTEGER NOT NULL,
			type TEXT NOT NULL,
			payload_json TEXT NOT NULL
		);
		CREATE UNIQUE INDEX idx_records_segment_seq_unique ON records(segment_id, segment_seq);
		INSERT INTO records (record_id, run_id, trace_id, segment_id, segment_seq, type, payload_json)
		VALUES ('rec_partial_v2_missing_column', 'run_partial_v2_missing_column', 'trace_partial_v2_missing_column', 'seg_partial_v2_missing_column_a', 1, 'run:start', '{"schemaVersion":2,"recordId":"rec_partial_v2_missing_column","type":"run:start","runId":"run_partial_v2_missing_column","traceId":"trace_partial_v2_missing_column","segmentId":"seg_partial_v2_missing_column_a","segmentSeq":1,"name":"partial v2","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}');
		CREATE TABLE run_segments (
			segment_id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL,
			status TEXT,
			started_at TEXT,
			ended_at TEXT,
			first_segment_seq INTEGER NOT NULL DEFAULT 0,
			last_segment_seq INTEGER NOT NULL DEFAULT 0
		);
		INSERT INTO run_segments (segment_id, run_id, status, started_at, first_segment_seq, last_segment_seq)
		VALUES ('seg_partial_v2_missing_column_a', 'run_partial_v2_missing_column', 'running', '2026-05-16T18:00:00.000Z', 1, 1);
	`); err != nil {
		t.Fatal(err)
	}
	service, err := NewService(db)
	if err != nil {
		t.Fatal(err)
	}
	records, err := service.listRecords(ctx, "run_partial_v2_missing_column")
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 0 {
		t.Fatalf("records after partial v2 records schema reset = %#v, want reset", records)
	}
	assertSQLiteColumn(t, service.db, "records", "received_at")
}

func TestServiceResetsV2ContractTablesWithExtraColumns(t *testing.T) {
	for _, test := range []struct {
		name   string
		table  string
		column string
	}{
		{name: "records raw schema version", table: "records", column: "raw_schema_version"},
		{name: "records synthetic", table: "records", column: "synthetic"},
		{name: "run segments lifecycle status", table: "run_segments", column: "lifecycle_status"},
		{name: "run segments lifecycle checked at", table: "run_segments", column: "lifecycle_checked_at"},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			db, err := sql.Open("sqlite", ":memory:")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := db.Close(); err != nil {
					t.Fatal(err)
				}
			})
			if err := createObservabilitySchema(ctx, db); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, fmt.Sprintf(`ALTER TABLE %s ADD COLUMN %s TEXT`, test.table, test.column)); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(ctx, `
				INSERT INTO records (record_id, run_id, operation_id, trace_id, segment_id, segment_seq, type, payload_json)
				VALUES ('rec_extra_v2', 'run_extra_v2', 'run_extra_v2', 'trace_extra_v2', 'seg_extra_v2_a', 1, 'run:start', '{}')
			`); err != nil {
				t.Fatal(err)
			}

			service, err := NewService(db)
			if err != nil {
				t.Fatal(err)
			}
			records, err := service.listRecords(ctx, "run_extra_v2")
			if err != nil {
				t.Fatal(err)
			}
			if len(records) != 0 {
				t.Fatalf("records after extra %s.%s column = %#v, want reset", test.table, test.column, records)
			}
			columns, exists, err := tableColumns(ctx, service.db, test.table)
			if err != nil {
				t.Fatal(err)
			}
			if !exists || columns[test.column] {
				t.Fatalf("columns after reset = %#v, want canonical %s schema", columns, test.table)
			}
		})
	}
}

func TestServiceDeleteRunsRemovesV2DependentTables(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_delete_start","type":"run:start","runId":"run_delete_v2","traceId":"dddddddddddddddddddddddddddddddd","segmentId":"seg_delete_a","segmentSeq":1,"name":"delete","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_delete_end","type":"run:end","runId":"run_delete_v2","traceId":"dddddddddddddddddddddddddddddddd","segmentId":"seg_delete_a","segmentSeq":2,"endedAt":"2026-05-16T18:00:01.000Z","status":"ok"}`,
	)); err != nil {
		t.Fatal(err)
	}
	deleted, err := service.DeleteRuns(ctx, []string{"run_delete_v2"})
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 1 || deleted[0] != "run_delete_v2" {
		t.Fatalf("deleted = %#v", deleted)
	}
	for _, table := range []string{"records", "run_segments"} {
		assertRetentionTableCount(t, service, table, 0)
	}
}

func TestServiceTreatsRecordIDsAsImmutable(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	first := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_immutable_start","type":"run:start","runId":"run_immutable","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_immutable_a","segmentSeq":1,"name":"immutable","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_immutable_usage","type":"span:event","runId":"run_immutable","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_immutable_a","segmentSeq":2,"spanId":"1111111111111111","eventId":"evt_immutable_usage","name":"usage.observed","timestamp":"2026-05-16T18:00:00.500Z","attributes":{"inputTokens":3,"outputTokens":4,"cost":0.01}}`,
	)
	if err := service.Ingest(ctx, first); err != nil {
		t.Fatal(err)
	}
	run, err := service.Run(ctx, "run_immutable")
	if err != nil {
		t.Fatal(err)
	}
	if run.RecordCount != 2 || run.inputTokens != 3 || run.outputTokens != 4 {
		t.Fatalf("initial run = %#v, want two records and first usage rollup", run)
	}

	if err := service.Ingest(ctx, first); err != nil {
		t.Fatal(err)
	}
	run, err = service.Run(ctx, "run_immutable")
	if err != nil {
		t.Fatal(err)
	}
	if run.RecordCount != 2 || run.inputTokens != 3 || run.outputTokens != 4 {
		t.Fatalf("after duplicate ingest = %#v, want unchanged rollups", run)
	}

	conflict := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_immutable_usage","type":"span:event","runId":"run_immutable","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_immutable_a","segmentSeq":99,"spanId":"1111111111111111","eventId":"evt_immutable_usage_conflict","name":"usage.observed","timestamp":"2026-05-16T18:00:00.900Z","attributes":{"inputTokens":30,"outputTokens":40,"cost":0.99}}`,
	)
	if err := service.Ingest(ctx, conflict); err == nil {
		t.Fatal("conflicting recordId ingest succeeded, want immutable identity error")
	}
	var healthCount int
	var healthMessage string
	if err := service.db.QueryRowContext(ctx, `
		SELECT occurrence_count, message
		FROM ingest_health
		WHERE code = 'record_id_conflict' AND record_id = 'rec_immutable_usage'
	`).Scan(&healthCount, &healthMessage); err != nil {
		t.Fatalf("load durable conflict health: %v", err)
	}
	if healthCount != 1 || healthMessage != "record ID reused with different canonical content" {
		t.Fatalf("conflict health = %d/%q, want bounded sanitized diagnostic", healthCount, healthMessage)
	}
	if strings.Contains(healthMessage, "inputTokens") || strings.Contains(healthMessage, "0.99") {
		t.Fatalf("conflict health leaked record content: %q", healthMessage)
	}
	graph, err := service.Graph(ctx, "run_immutable")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := recordIDs(graph.Records), []string{"rec_immutable_start", "rec_immutable_usage"}; !equalStringSlices(got, want) {
		t.Fatalf("records after conflict = %#v, want %#v", got, want)
	}
	if graph.Records[1].SegmentSeq != 2 || !strings.Contains(graph.Records[1].PayloadJSON, `"inputTokens":3`) {
		t.Fatalf("conflict mutated stored record: %#v", graph.Records[1])
	}
	run, err = service.Run(ctx, "run_immutable")
	if err != nil {
		t.Fatal(err)
	}
	if run.RecordCount != 2 || run.inputTokens != 3 || run.outputTokens != 4 {
		t.Fatalf("after conflict = %#v, want first record projections retained", run)
	}
}

func TestServicePersistsBoundedSanitizedSourceHealth(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	health := SourceHealth{
		SourceID:            "source_storage_health",
		Accepted:            4,
		Retried:             2,
		PermanentlyRejected: 1,
		OverflowDropped:     3,
		DeadlineDropped:     1,
		LastError: &SourceHealthError{
			Code:    "delivery retry/unsafe",
			Message: "https://collector.example/private Bearer secret-token\nnext",
		},
	}
	if err := service.RecordSourceHealth(ctx, health); err != nil {
		t.Fatal(err)
	}
	var accepted, retried, rejected, overflow, deadline int
	var code, message string
	if err := service.db.QueryRowContext(ctx, `
		SELECT accepted, retried, permanently_rejected, overflow_dropped,
			deadline_dropped, last_error_code, last_error_message
		FROM observability_source_health WHERE source_id = 'source_storage_health'
	`).Scan(&accepted, &retried, &rejected, &overflow, &deadline, &code, &message); err != nil {
		t.Fatal(err)
	}
	if accepted != 4 || retried != 2 || rejected != 1 || overflow != 3 || deadline != 1 {
		t.Fatalf("source counters = %d/%d/%d/%d/%d", accepted, retried, rejected, overflow, deadline)
	}
	if code != "delivery_retry_unsafe" || message != "[url] Bearer [redacted] next" {
		t.Fatalf("source diagnostic = %q/%q, want sanitized values", code, message)
	}
}

func TestServiceRejectsSegmentOwnershipAndSequenceCollisionsTransactionally(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_segment_owner_start","type":"run:start","runId":"run_segment_owner_a","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_segment_owner_a","segmentSeq":1,"name":"owner","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_segment_owner_span","type":"span","runId":"run_segment_owner_a","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_segment_owner_a","segmentSeq":2,"spanId":"1111111111111111","family":"generation","primitive":"generation.call","name":"generate","startedAt":"2026-05-16T18:00:00.100Z","endedAt":"2026-05-16T18:00:00.200Z","durationMs":100,"status":"ok"}`,
	)); err != nil {
		t.Fatal(err)
	}

	ownerConflict := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_segment_owner_conflict","type":"span","runId":"run_segment_owner_b","traceId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","segmentId":"seg_segment_owner_a","segmentSeq":3,"spanId":"2222222222222222","family":"generation","primitive":"generation.call","name":"conflict","startedAt":"2026-05-16T18:00:00.300Z","endedAt":"2026-05-16T18:00:00.400Z","durationMs":100,"status":"ok"}`,
	)
	if err := service.Ingest(ctx, ownerConflict); err == nil || !strings.Contains(err.Error(), "segment_ownership_conflict") {
		t.Fatalf("owner conflict err = %v, want segment_ownership_conflict", err)
	}

	orderConflict := mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_segment_seq_conflict","type":"span:event","runId":"run_segment_owner_a","traceId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","segmentId":"seg_segment_owner_a","segmentSeq":2,"spanId":"1111111111111111","eventId":"evt_segment_seq_conflict","name":"usage.observed","timestamp":"2026-05-16T18:00:00.250Z","attributes":{"inputTokens":50}}`,
	)
	if err := service.Ingest(ctx, orderConflict); err == nil || !strings.Contains(err.Error(), "segment_sequence_conflict") {
		t.Fatalf("sequence conflict err = %v, want segment_sequence_conflict", err)
	}

	records, err := service.listRecords(ctx, "run_segment_owner_a")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := recordIDs(records), []string{"rec_segment_owner_start", "rec_segment_owner_span"}; !equalStringSlices(got, want) {
		t.Fatalf("records after conflicts = %#v, want %#v", got, want)
	}
	records, err = service.listRecords(ctx, "run_segment_owner_b")
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 0 {
		t.Fatalf("conflicting run records = %#v, want rollback with no projection mutation", records)
	}
}

func TestServiceRequiresRunStartAtSegmentSeqOne(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_bad_start_seq","type":"run:start","runId":"run_bad_start_seq","traceId":"cccccccccccccccccccccccccccccccc","segmentId":"seg_bad_start_seq_a","segmentSeq":2,"name":"bad","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
	))
	if err == nil || !strings.Contains(err.Error(), "segmentSeq 1") {
		t.Fatalf("run:start segmentSeq err = %v, want segmentSeq 1 validation error", err)
	}
	records, err := service.listRecords(ctx, "run_bad_start_seq")
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 0 {
		t.Fatalf("bad run:start records = %#v, want rejected transaction", records)
	}
}

func TestServiceKeepsTerminalStatusWhenRunEndArrivesBeforeStart(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_terminal_first_end","type":"run:end","runId":"run_terminal_first","traceId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","segmentId":"seg_terminal_first_a","segmentSeq":2,"endedAt":"2026-05-16T18:00:01.000Z","durationMs":1000,"status":"ok"}`,
		`{"schemaVersion":2,"recordId":"rec_terminal_first_start","type":"run:start","runId":"run_terminal_first","traceId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","segmentId":"seg_terminal_first_a","segmentSeq":1,"name":"terminal first","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
	)); err != nil {
		t.Fatal(err)
	}

	run, err := service.Run(ctx, "run_terminal_first")
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "ok" || run.StartedAt != "2026-05-16T18:00:00.000Z" || run.EndedAt != "2026-05-16T18:00:01.000Z" {
		t.Fatalf("run projection = %#v, want terminal status with deterministic start/end times", run)
	}
	var status, startedAt, endedAt string
	if err := service.db.QueryRowContext(ctx, `
		SELECT status, started_at, ended_at
		FROM run_segments
		WHERE run_id = 'run_terminal_first' AND segment_id = 'seg_terminal_first_a'
	`).Scan(&status, &startedAt, &endedAt); err != nil {
		t.Fatal(err)
	}
	if status != "ok" || startedAt != "2026-05-16T18:00:00.000Z" || endedAt != "2026-05-16T18:00:01.000Z" {
		t.Fatalf("segment projection = %q/%q/%q, want terminal with deterministic times", status, startedAt, endedAt)
	}
}

func TestServiceKeepsFirstProjectedTerminalStatus(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_first_terminal_start","type":"run:start","runId":"run_first_terminal","traceId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","segmentId":"seg_first_terminal_a","segmentSeq":1,"name":"first terminal","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":2,"recordId":"rec_first_terminal_ok","type":"run:end","runId":"run_first_terminal","traceId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","segmentId":"seg_first_terminal_a","segmentSeq":2,"endedAt":"2026-05-16T18:00:01.000Z","durationMs":1000,"status":"ok"}`,
	)); err != nil {
		t.Fatal(err)
	}
	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":2,"recordId":"rec_first_terminal_error","type":"run:end","runId":"run_first_terminal","traceId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","segmentId":"seg_first_terminal_a","segmentSeq":3,"endedAt":"2026-05-16T18:00:02.000Z","durationMs":2000,"status":"error","error":{"message":"late"}}`,
	)); err != nil {
		t.Fatal(err)
	}
	run, err := service.Run(ctx, "run_first_terminal")
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "conflicted" || run.EndedAt != "2026-05-16T18:00:01.000Z" {
		t.Fatalf("run projection = %#v, want conflicted status and first terminal timestamp", run)
	}
	var segmentStatus, segmentEndedAt string
	if err := service.db.QueryRowContext(ctx, `
		SELECT status, ended_at
		FROM run_segments
		WHERE segment_id = 'seg_first_terminal_a'
	`).Scan(&segmentStatus, &segmentEndedAt); err != nil {
		t.Fatal(err)
	}
	if segmentStatus != "ok" || segmentEndedAt != "2026-05-16T18:00:01.000Z" {
		t.Fatalf("segment projection = %q/%q, want first terminal stable", segmentStatus, segmentEndedAt)
	}
}

func assertRunSegmentsPrimaryKey(t *testing.T, db *sql.DB, want []string) {
	t.Helper()
	rows, err := db.Query(`PRAGMA table_info(run_segments)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := make([]string, len(want))
	count := 0
	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &pk); err != nil {
			t.Fatal(err)
		}
		if pk > 0 {
			count++
			if pk <= len(got) {
				got[pk-1] = name
			}
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if count != len(want) || !equalStringSlices(got, want) {
		t.Fatalf("run_segments primary key = %#v count %d, want %#v", got, count, want)
	}
}
