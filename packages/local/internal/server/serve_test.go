package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func findFreePort() int {
	for port := 14400; port < 14500; port++ {
		if IsPortAvailable(port) {
			return port
		}
	}
	return 14400
}

func TestDevServer_start_and_query(t *testing.T) {
	port := findFreePort()
	srv := NewDevServer(DevServerOptions{Port: port, QualityDir: t.TempDir()})

	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	defer srv.Shutdown(context.Background())

	// Give server a moment to start listening
	time.Sleep(50 * time.Millisecond)

	// Should be able to hit /api/stats
	resp, err := http.Get(fmt.Sprintf("http://localhost:%d/api/stats", port))
	if err != nil {
		t.Fatalf("GET /api/stats error: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}

	var stats store.StatsResult
	if err := json.NewDecoder(resp.Body).Decode(&stats); err != nil {
		t.Fatalf("JSON decode error: %v", err)
	}
}

func TestDevServer_ingest_and_read(t *testing.T) {
	port := findFreePort()
	srv := NewDevServer(DevServerOptions{Port: port, QualityDir: t.TempDir()})

	if err := srv.Start(); err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	defer srv.Shutdown(context.Background())

	time.Sleep(50 * time.Millisecond)

	baseURL := fmt.Sprintf("http://localhost:%d", port)

	body := `{"records":[
		{"schemaVersion":1,"recordId":"rec_run_start","type":"run:start","runId":"run-live","traceId":"trace-live","name":"live","rootPrimitive":"generation.call","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":1,"recordId":"rec_run_end","type":"run:end","runId":"run-live","traceId":"trace-live","endedAt":"2026-05-16T18:00:00.010Z","durationMs":10,"status":"ok"}
	]}`
	resp, err := http.Post(baseURL+"/api/observability/records", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("POST status = %d, want %d", resp.StatusCode, http.StatusAccepted)
	}

	resp, err = http.Get(baseURL + "/api/observability/runs")
	if err != nil {
		t.Fatalf("GET error: %v", err)
	}
	defer resp.Body.Close()

	var runs []observability.RunSummary
	if err := json.NewDecoder(resp.Body).Decode(&runs); err != nil {
		t.Fatalf("decode runs: %v", err)
	}
	if len(runs) != 1 || runs[0].RunID != "run-live" || runs[0].Status != "ok" {
		t.Errorf("runs = %#v, want run-live ok", runs)
	}
}
