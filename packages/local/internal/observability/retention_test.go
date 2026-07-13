package observability

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestServiceRetentionDeletesRunsByAgeAndCount(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	now := time.Now().UTC()
	for i := 0; i < 4; i++ {
		insertRetentionRun(t, service, fmt.Sprintf("run_old_%d", i), now.AddDate(0, 0, -20).Add(time.Duration(i)*time.Minute))
	}
	for i := 0; i < 4; i++ {
		insertRetentionRun(t, service, fmt.Sprintf("run_recent_%d", i), now.Add(time.Duration(i)*time.Minute))
	}
	insertRetentionRunWithStatus(t, service, "run_old_running", now.AddDate(0, 0, -30), "running")

	deleted, err := service.runRetention(ctx, retentionSettings{
		MaxRunAge:       14 * 24 * time.Hour,
		MaxRuns:         2,
		PreviewMaxBytes: defaultArtifactPreviewMaxBytes,
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 6 {
		t.Fatalf("deleted = %d, want 6", deleted)
	}
	assertRetentionRunIDs(t, service, []string{"run_old_running", "run_recent_2", "run_recent_3"})
	assertRetentionTableCount(t, service, "records", 3)
}

func TestServiceRetentionCapsArtifactPreviewAtIngest(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)
	service.retentionSettings.PreviewMaxBytes = 12

	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":1,"recordId":"rec_preview_run","type":"run:start","runId":"run_preview_cap","traceId":"trace_preview_cap","name":"preview","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":1,"recordId":"rec_preview_artifact","type":"artifact","runId":"run_preview_cap","traceId":"trace_preview_cap","artifactId":"artifact_preview_cap","spanId":"span_preview","kind":"output","createdAt":"2026-05-16T18:00:00.010Z","contentType":"application/json","encoding":"json","sizeBytes":2048,"hash":"sha256:abc","preview":{"text":"this preview is intentionally too large"}}`,
	)); err != nil {
		t.Fatal(err)
	}

	graph, err := service.Graph(ctx, "run_preview_cap")
	if err != nil {
		t.Fatal(err)
	}
	if len(graph.Artifacts) != 1 {
		t.Fatalf("artifact count = %d, want 1", len(graph.Artifacts))
	}
	got := string(graph.Artifacts[0].Preview)
	want := `{"__crux_truncated":true,"bytes":50}`
	if got != want {
		t.Fatalf("preview = %s, want %s", got, want)
	}
	if graph.Artifacts[0].Hash != "sha256:abc" || graph.Artifacts[0].SizeBytes != 2048 {
		t.Fatalf("artifact metadata = %#v, want hash/size preserved", graph.Artifacts[0])
	}
}

func TestServiceRetentionSanitizesLegacyMediaBeforeCaps(t *testing.T) {
	ctx := context.Background()
	service := newTestService(t)

	if err := service.Ingest(ctx, mustBatch(t,
		`{"schemaVersion":1,"recordId":"rec_media_run","type":"run:start","runId":"run_media_safe","traceId":"trace_media_safe","name":"media","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}`,
		`{"schemaVersion":1,"recordId":"rec_media_artifact","type":"artifact","runId":"run_media_safe","traceId":"trace_media_safe","artifactId":"artifact_media_safe","kind":"output","createdAt":"2026-05-16T18:00:00.010Z","contentType":"application/json","encoding":"json","preview":{"content":[{"type":"image","source":"data:image/png;base64,SECRET_BYTES","mediaType":"image/png","filename":"SECRET.png"},{"kind":"file","mediaType":"application/pdf","sizeBytes":42,"pageCount":2,"digestPrefix":"abcdef123456","sourceCategory":"asset-ref","ref":"asset://SECRET"}],"nested":{"signed":"https://example.com/file?SECRET_TOKEN=yes"}}}`,
	)); err != nil {
		t.Fatal(err)
	}

	graph, err := service.Graph(ctx, "run_media_safe")
	if err != nil {
		t.Fatal(err)
	}
	got := string(graph.Artifacts[0].Preview)
	for _, secret := range []string{"SECRET_BYTES", "SECRET.png", "asset://SECRET", "SECRET_TOKEN"} {
		if strings.Contains(got, secret) {
			t.Fatalf("preview leaked %q: %s", secret, got)
		}
	}
	want := `{"content":[{"kind":"image","mediaType":"image/png","sourceCategory":"data"},{"digestPrefix":"abcdef123456","kind":"file","mediaType":"application/pdf","pageCount":2,"sizeBytes":42,"sourceCategory":"asset-ref"}],"nested":{"signed":"[url]"}}`
	if got != want {
		t.Fatalf("preview = %s, want %s", got, want)
	}
}

func insertRetentionRun(t *testing.T, service *Service, runID string, started time.Time) {
	t.Helper()
	insertRetentionRunWithStatus(t, service, runID, started, "ok")
}

func insertRetentionRunWithStatus(t *testing.T, service *Service, runID string, started time.Time, status string) {
	t.Helper()
	timestamp := started.Format(time.RFC3339Nano)
	if _, err := service.db.Exec(`
		INSERT INTO runs (run_id, trace_id, name, root_primitive, status, started_at, last_activity_at)
		VALUES (?, ?, 'retained', 'agent.run', ?, ?, ?)
	`, runID, "trace_"+runID, status, timestamp, timestamp); err != nil {
		t.Fatal(err)
	}
	if _, err := service.db.Exec(`
		INSERT INTO records (record_id, run_id, trace_id, seq, type, payload_json)
		VALUES (?, ?, ?, 1, 'run:start', '{}')
	`, "record_"+runID, runID, "trace_"+runID); err != nil {
		t.Fatal(err)
	}
}

func assertRetentionRunIDs(t *testing.T, service *Service, want []string) {
	t.Helper()
	rows, err := service.db.Query(`SELECT run_id FROM runs ORDER BY started_at, run_id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := make([]string, 0, len(want))
	for rows.Next() {
		var runID string
		if err := rows.Scan(&runID); err != nil {
			t.Fatal(err)
		}
		got = append(got, runID)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("run ids = %#v, want %#v", got, want)
	}
}

func assertRetentionTableCount(t *testing.T, service *Service, table string, want int) {
	t.Helper()
	var got int
	if err := service.db.QueryRow("SELECT count(*) FROM " + table).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("%s count = %d, want %d", table, got, want)
	}
}
