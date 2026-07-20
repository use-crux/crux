package localserver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/observability"
)

// TestObservabilitySoakReconcilesEmittedAcceptedRejectedAndVisibleCounts is a
// bounded fault-injection soak against a real observability.Service and a
// real net/http server (httptest.NewServer, a genuine socket, not an
// in-process ResponseRecorder), reconciling every disposition the server
// returned against what later becomes visible through the joined, revisioned
// runs/page read model.
//
// This is the server-side half of the observability soak evidence: real
// accept/duplicate-idempotent/conflicting-duplicate/invalid-schema decisions,
// concurrent ingestion, multi-segment suspend/resume projection, and
// projected+visible reconciliation, all against a real SQLite-backed service
// and a real HTTP server. It deliberately does NOT exercise client-side
// retry/backoff or drop accounting (partial-202-then-retry, a dropped
// response after the collector already committed a batch, a `503` with
// `Retry-After`) — those are TypeScript delivery-engine concepts with no
// equivalent on this side of the wire; the Go server here only ever sees one
// HTTP request and returns one disposition set per request; it has no notion
// of a client that retries. That half of binding spec 05 section 3's fault
// list is covered by
// `packages/core/__tests__/observability/delivery-soak.test.ts`, which
// reconciles `acceptedRecords`/`retriedRecords`/`permanentlyRejectedRecords`
// against the real delivery engine and a scripted `fetch`. Composed, the two
// soaks cover the full fault list; neither alone does.
func TestObservabilitySoakReconcilesEmittedAcceptedRejectedAndVisibleCounts(t *testing.T) {
	ctx := context.Background()
	service, err := observability.OpenService(ctx, ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = service.Close() })
	mux := http.NewServeMux()
	registerObservabilityRoutes(mux, service, nil)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	client := server.Client()

	const freshRuns = 200
	const concurrentRuns = 40

	var (
		emitted          int
		accepted         int
		rejectedConflict int
		rejectedInvalid  int
		rejectedOther    int
	)

	// postSafe never calls t.Fatal*: it is called from concurrent goroutines
	// below, and testing.T requires Fatal/FailNow to be called only from the
	// goroutine running the test function itself. Callers on the main test
	// goroutine use post(), which reports the same error via t.Fatal.
	postSafe := func(body string) ([]observability.IngestDisposition, error) {
		body, err := withSoakOperationIDs(body)
		if err != nil {
			return nil, err
		}
		resp, err := client.Post(server.URL+"/api/observability/records", "application/json", bytes.NewReader([]byte(body)))
		if err != nil {
			return nil, fmt.Errorf("POST /api/observability/records: %w", err)
		}
		defer resp.Body.Close()
		var payload observabilityIngestResponse
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			return nil, fmt.Errorf("decode ingest response: %w", err)
		}
		return payload.Dispositions, nil
	}

	post := func(t *testing.T, body string) []observability.IngestDisposition {
		t.Helper()
		dispositions, err := postSafe(body)
		if err != nil {
			t.Fatal(err)
		}
		return dispositions
	}

	tally := func(dispositions []observability.IngestDisposition) {
		for _, d := range dispositions {
			emitted++
			switch {
			case d.Outcome == "accepted":
				accepted++
			case d.Code == "record_id_conflict":
				rejectedConflict++
			case d.Code == "invalid_record":
				rejectedInvalid++
			default:
				rejectedOther++
			}
		}
	}

	// --- Fault 1: freshRuns distinct, ordinary one-segment success runs. ---
	for i := 0; i < freshRuns; i++ {
		runID := fmt.Sprintf("soak_run_fresh_%d", i)
		body := fmt.Sprintf(`{"schemaVersion":4,"records":[
			{"schemaVersion":4,"recordId":"%s_start","type":"run:start","runId":"%s","segmentId":"%s_seg","segmentSeq":1,"traceId":"11111111111111111111111111111111","name":"soak","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
			{"schemaVersion":4,"recordId":"%s_end","type":"run:end","runId":"%s","segmentId":"%s_seg","segmentSeq":2,"traceId":"11111111111111111111111111111111","endedAt":"2026-05-16T18:00:01.000Z","status":"ok"}
		]}`, runID, runID, runID, runID, runID, runID)
		tally(post(t, body))
	}

	// --- Fault 2: duplicate identical record resend must be idempotent (accepted, not double-projected). ---
	duplicateBody := fmt.Sprintf(`{"schemaVersion":4,"records":[
		{"schemaVersion":4,"recordId":"soak_run_fresh_0_start","type":"run:start","runId":"soak_run_fresh_0","segmentId":"soak_run_fresh_0_seg","segmentSeq":1,"traceId":"11111111111111111111111111111111","name":"soak","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}
	]}`)
	tally(post(t, duplicateBody))

	// --- Fault 3: conflicting duplicate (same recordId, different canonical content) must be a diagnosed permanent rejection. ---
	conflictBody := fmt.Sprintf(`{"schemaVersion":4,"records":[
		{"schemaVersion":4,"recordId":"soak_run_fresh_0_start","type":"run:start","runId":"soak_run_fresh_0","segmentId":"soak_run_fresh_0_seg","segmentSeq":1,"traceId":"11111111111111111111111111111111","name":"tampered","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}
	]}`)
	conflictDispositions := post(t, conflictBody)
	tally(conflictDispositions)
	if len(conflictDispositions) != 1 || conflictDispositions[0].Outcome != "rejected" || conflictDispositions[0].Code != "record_id_conflict" {
		t.Fatalf("conflicting duplicate disposition = %#v, want one rejected/record_id_conflict", conflictDispositions)
	}

	// --- Fault 4: unsupported schema version must be a diagnosed permanent rejection, not a silent drop. ---
	invalidSchemaBody := `{"schemaVersion":4,"records":[
		{"schemaVersion":1,"recordId":"soak_run_invalid_schema","type":"run:start","runId":"soak_run_invalid_schema","segmentId":"soak_run_invalid_schema_seg","segmentSeq":1,"traceId":"11111111111111111111111111111111","name":"invalid","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"}
	]}`
	invalidDispositions := post(t, invalidSchemaBody)
	tally(invalidDispositions)
	if len(invalidDispositions) != 1 || invalidDispositions[0].Outcome != "rejected" || invalidDispositions[0].Code != "invalid_record" {
		t.Fatalf("invalid schema disposition = %#v, want one rejected/invalid_record", invalidDispositions)
	}

	// --- Fault 5: suspend in one request, resume in a second, distinct request (simulates a fresh process/invocation). ---
	multiSegRunID := "soak_run_multiseg"
	tally(post(t, fmt.Sprintf(`{"schemaVersion":4,"records":[
		{"schemaVersion":4,"recordId":"%s_start","type":"run:start","runId":"%s","segmentId":"%s_seg_a","segmentSeq":1,"traceId":"22222222222222222222222222222222","name":"soak-multiseg","rootPrimitive":"flow.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
		{"schemaVersion":4,"recordId":"%s_suspend","type":"run:suspend","runId":"%s","segmentId":"%s_seg_a","segmentSeq":2,"traceId":"22222222222222222222222222222222","suspendedAt":"2026-05-16T18:00:01.000Z","reason":"soak-boundary"}
	]}`, multiSegRunID, multiSegRunID, multiSegRunID, multiSegRunID, multiSegRunID, multiSegRunID)))
	tally(post(t, fmt.Sprintf(`{"schemaVersion":4,"records":[
		{"schemaVersion":4,"recordId":"%s_resume","type":"run:resume","runId":"%s","segmentId":"%s_seg_b","segmentSeq":1,"traceId":"22222222222222222222222222222222","resumedAt":"2026-05-16T18:00:02.000Z","reason":"soak-boundary","previousSegmentId":"%s_seg_a"},
		{"schemaVersion":4,"recordId":"%s_end","type":"run:end","runId":"%s","segmentId":"%s_seg_b","segmentSeq":2,"traceId":"22222222222222222222222222222222","endedAt":"2026-05-16T18:00:03.000Z","status":"ok"}
	]}`, multiSegRunID, multiSegRunID, multiSegRunID, multiSegRunID, multiSegRunID, multiSegRunID, multiSegRunID)))

	// --- Fault 6: concurrent segments across goroutines (concurrent processes ingesting at once). ---
	// Goroutines report their outcome over a channel rather than calling
	// t.Fatal* themselves: testing.T requires FailNow (which Fatal/Fatalf
	// call) to be invoked only from the goroutine running the test function,
	// never from a goroutine the test spawns.
	type concurrentResult struct {
		index        int
		dispositions []observability.IngestDisposition
		err          error
	}
	var wg sync.WaitGroup
	results := make(chan concurrentResult, concurrentRuns)
	for i := 0; i < concurrentRuns; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			runID := fmt.Sprintf("soak_run_concurrent_%d", i)
			body := fmt.Sprintf(`{"schemaVersion":4,"records":[
				{"schemaVersion":4,"recordId":"%s_start","type":"run:start","runId":"%s","segmentId":"%s_seg","segmentSeq":1,"traceId":"33333333333333333333333333333333","name":"soak-concurrent","rootPrimitive":"agent.run","startedAt":"2026-05-16T18:00:00.000Z","status":"running"},
				{"schemaVersion":4,"recordId":"%s_end","type":"run:end","runId":"%s","segmentId":"%s_seg","segmentSeq":2,"traceId":"33333333333333333333333333333333","endedAt":"2026-05-16T18:00:01.000Z","status":"ok"}
			]}`, runID, runID, runID, runID, runID, runID)
			dispositions, err := postSafe(body)
			results <- concurrentResult{index: i, dispositions: dispositions, err: err}
		}(i)
	}
	wg.Wait()
	close(results)
	for result := range results {
		if result.err != nil {
			t.Fatalf("concurrent POST %d failed: %v", result.index, result.err)
		}
		tally(result.dispositions)
	}

	// --- Reconciliation: every emitted record must land in exactly one bucket. ---
	if total := accepted + rejectedConflict + rejectedInvalid + rejectedOther; total != emitted {
		t.Fatalf("reconciliation mismatch: emitted=%d but accepted(%d)+conflict(%d)+invalid(%d)+other(%d)=%d",
			emitted, accepted, rejectedConflict, rejectedInvalid, rejectedOther, total)
	}
	wantEmitted := freshRuns*2 + 1 /* duplicate */ + 1 /* conflict */ + 1 /* invalid schema */ + 4 /* multi-segment */ + concurrentRuns*2
	if emitted != wantEmitted {
		t.Fatalf("emitted = %d, want %d", emitted, wantEmitted)
	}
	wantAccepted := freshRuns*2 + 1 /* idempotent duplicate */ + 4 /* multi-segment */ + concurrentRuns*2
	if accepted != wantAccepted {
		t.Fatalf("accepted = %d, want %d", accepted, wantAccepted)
	}
	if rejectedConflict != 1 {
		t.Fatalf("rejectedConflict = %d, want 1", rejectedConflict)
	}
	if rejectedInvalid != 1 {
		t.Fatalf("rejectedInvalid = %d, want 1", rejectedInvalid)
	}
	if rejectedOther != 0 {
		t.Fatalf("rejectedOther = %d, want 0", rejectedOther)
	}

	// --- Projected/visible reconciliation: every accepted run must be exactly once in the read model, not duplicated by the idempotent resend. ---
	wantDistinctRuns := freshRuns + 1 /* multi-segment */ + concurrentRuns
	page := fetchRunsPage(t, client, server.URL, wantDistinctRuns+10)
	if page.Revision == 0 {
		t.Fatal("runs/page revision was not populated after ingest")
	}
	seen := map[string]int{}
	for _, row := range page.Rows {
		seen[row.RunID]++
	}
	for i := 0; i < freshRuns; i++ {
		runID := fmt.Sprintf("soak_run_fresh_%d", i)
		if seen[runID] != 1 {
			t.Fatalf("run %s visible %d times, want exactly 1 (idempotent duplicate must not double-project)", runID, seen[runID])
		}
	}
	for i := 0; i < concurrentRuns; i++ {
		runID := fmt.Sprintf("soak_run_concurrent_%d", i)
		if seen[runID] != 1 {
			t.Fatalf("concurrent run %s visible %d times, want exactly 1", runID, seen[runID])
		}
	}
	if seen[multiSegRunID] != 1 {
		t.Fatalf("multi-segment run visible %d times, want exactly 1", seen[multiSegRunID])
	}
	if seen["soak_run_invalid_schema"] != 0 {
		t.Fatal("rejected invalid-schema record must never become a visible run")
	}

	// The multi-segment run must show its real two-segment lifecycle, not a collapsed single segment.
	summary, err := service.Run(ctx, multiSegRunID)
	if err != nil {
		t.Fatalf("multi-segment run not projected: %v", err)
	}
	if summary.Status != "ok" {
		t.Fatalf("multi-segment run status = %q, want ok", summary.Status)
	}
	if summary.SegmentCount != 2 {
		t.Fatalf("multi-segment run SegmentCount = %d, want 2", summary.SegmentCount)
	}

	t.Logf(
		"soak reconciliation: emitted=%d accepted=%d rejected_conflict=%d rejected_invalid=%d rejected_other=%d distinct_runs_visible=%d revision=%d",
		emitted, accepted, rejectedConflict, rejectedInvalid, rejectedOther, len(seen), page.Revision,
	)
}

func withSoakOperationIDs(body string) (string, error) {
	var envelope map[string]any
	if err := json.Unmarshal([]byte(body), &envelope); err != nil {
		return "", fmt.Errorf("decode soak batch: %w", err)
	}
	records, _ := envelope["records"].([]any)
	for _, value := range records {
		record, _ := value.(map[string]any)
		if _, present := record["operationId"]; present {
			continue
		}
		record["operationId"] = record["runId"]
	}
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return "", fmt.Errorf("encode soak batch: %w", err)
	}
	return string(encoded), nil
}

func fetchRunsPage(t *testing.T, client *http.Client, baseURL string, limit int) observability.RunsResponse {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var page observability.RunsResponse
	for {
		resp, err := client.Get(fmt.Sprintf("%s/api/observability/runs/page?limit=%d", baseURL, limit))
		if err != nil {
			t.Fatalf("GET /api/observability/runs/page: %v", err)
		}
		err = json.NewDecoder(resp.Body).Decode(&page)
		resp.Body.Close()
		if err != nil {
			t.Fatalf("decode runs/page response: %v", err)
		}
		if page.NextCursor == "" || time.Now().After(deadline) {
			return page
		}
		// Bounded pagination: keep following the cursor if the soak's run count ever exceeds one page.
		rows := append([]observability.RunSummary{}, page.Rows...)
		next := fetchRunsPageAfter(t, client, baseURL, limit, page.NextCursor)
		next.Rows = append(rows, next.Rows...)
		return next
	}
}

func fetchRunsPageAfter(t *testing.T, client *http.Client, baseURL string, limit int, cursor string) observability.RunsResponse {
	t.Helper()
	resp, err := client.Get(fmt.Sprintf("%s/api/observability/runs/page?limit=%d&cursor=%s", baseURL, limit, cursor))
	if err != nil {
		t.Fatalf("GET /api/observability/runs/page (cursor): %v", err)
	}
	defer resp.Body.Close()
	var page observability.RunsResponse
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		t.Fatalf("decode runs/page cursor response: %v", err)
	}
	return page
}
