package observability

import (
	"context"
	"fmt"
	"reflect"
	"testing"
	"time"
)

// definitionRefJSON renders one DefinitionRef wire object for inline fixtures.
func definitionRefJSON(id, kind, role string) string {
	return fmt.Sprintf(`{"id":%q,"kind":%q,"role":%q}`, id, kind, role)
}

func runStartWithRefsJSON(recordID, runID, segmentID string, seq int, startedAt string, refs ...string) string {
	return fmt.Sprintf(`{"schemaVersion":2,"recordId":%q,"type":"run:start","runId":%q,"segmentId":%q,"segmentSeq":%d,"name":"n","rootPrimitive":"agent.run","startedAt":%q,"status":"running","definitionRefs":[%s]}`,
		recordID, runID, segmentID, seq, startedAt, joinRefs(refs))
}

func spanWithRefsJSON(recordID, runID, segmentID string, seq int, spanID, startedAt string, refs ...string) string {
	return fmt.Sprintf(`{"schemaVersion":2,"recordId":%q,"type":"span","runId":%q,"segmentId":%q,"segmentSeq":%d,"spanId":%q,"family":"prompt","primitive":"prompt.resolve","name":"resolve","startedAt":%q,"status":"ok","definitionRefs":[%s]}`,
		recordID, runID, segmentID, seq, spanID, startedAt, joinRefs(refs))
}

func joinRefs(refs []string) string {
	out := ""
	for i, ref := range refs {
		if i > 0 {
			out += ","
		}
		out += ref
	}
	return out
}

func mustIngest(t *testing.T, service *Service, records ...string) {
	t.Helper()
	if err := service.Ingest(context.Background(), mustBatch(t, records...)); err != nil {
		t.Fatalf("ingest failed: %v", err)
	}
}

func definitionActivity(t *testing.T, service *Service, runID string) []DefinitionActivity {
	t.Helper()
	activity, err := service.RunDefinitionActivity(context.Background(), runID)
	if err != nil {
		t.Fatalf("run definition activity for %q: %v", runID, err)
	}
	return activity
}

// TestDefinitionActivityProjectedInIngestTransaction proves DefinitionRefs from
// run:start and span records are projected into run_definition_activity, keyed
// by (run, definition), carrying the referenced kind/role and one occurrence.
func TestDefinitionActivityProjectedInIngestTransaction(t *testing.T) {
	service := newTestService(t)
	mustIngest(t,
		service,
		runStartWithRefsJSON("r-start", "run1", "seg1", 1, "2026-01-01T00:00:00.000Z",
			definitionRefJSON("agent:planner", "agent", "invoked-agent")),
		spanWithRefsJSON("r-span", "run1", "seg1", 2, "sp1", "2026-01-01T00:00:01.000Z",
			definitionRefJSON("prompt:greeting", "prompt", "resolved-prompt")),
	)

	got := definitionActivity(t, service, "run1")
	want := []DefinitionActivity{
		{DefinitionID: "agent:planner", DefinitionKind: "agent", Role: "invoked-agent", FirstSeenAt: "2026-01-01T00:00:00.000Z", LastSeenAt: "2026-01-01T00:00:00.000Z", OccurrenceCount: 1},
		{DefinitionID: "prompt:greeting", DefinitionKind: "prompt", Role: "resolved-prompt", FirstSeenAt: "2026-01-01T00:00:01.000Z", LastSeenAt: "2026-01-01T00:00:01.000Z", OccurrenceCount: 1},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("definition activity mismatch:\n got %+v\nwant %+v", got, want)
	}
}

// TestDefinitionActivityOccurrenceAndSeenSemantics proves repeated genuinely-new
// records touching the same definition raise occurrence_count and advance
// last_seen_at while keeping first_seen_at at the earliest record.
func TestDefinitionActivityOccurrenceAndSeenSemantics(t *testing.T) {
	service := newTestService(t)
	mustIngest(t,
		service,
		runStartWithRefsJSON("r-start", "run1", "seg1", 1, "2026-01-01T00:00:00.000Z"),
		spanWithRefsJSON("r-span1", "run1", "seg1", 2, "sp1", "2026-01-01T00:00:02.000Z",
			definitionRefJSON("prompt:greeting", "prompt", "resolved-prompt")),
		spanWithRefsJSON("r-span2", "run1", "seg1", 3, "sp2", "2026-01-01T00:00:05.000Z",
			definitionRefJSON("prompt:greeting", "prompt", "resolved-prompt")),
	)

	got := definitionActivity(t, service, "run1")
	want := []DefinitionActivity{
		{DefinitionID: "prompt:greeting", DefinitionKind: "prompt", Role: "resolved-prompt", FirstSeenAt: "2026-01-01T00:00:02.000Z", LastSeenAt: "2026-01-01T00:00:05.000Z", OccurrenceCount: 2},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("occurrence/seen mismatch:\n got %+v\nwant %+v", got, want)
	}
}

// TestDefinitionActivityDuplicateRecordDoesNotDoubleCount proves re-ingesting an
// already-seen recordId inherits idempotency from the existing ingest-dedup path
// and never re-increments occurrence_count.
func TestDefinitionActivityDuplicateRecordDoesNotDoubleCount(t *testing.T) {
	service := newTestService(t)
	span := spanWithRefsJSON("r-span", "run1", "seg1", 2, "sp1", "2026-01-01T00:00:01.000Z",
		definitionRefJSON("prompt:greeting", "prompt", "resolved-prompt"))
	mustIngest(t, service,
		runStartWithRefsJSON("r-start", "run1", "seg1", 1, "2026-01-01T00:00:00.000Z"),
		span,
	)
	// Re-ingest the identical span record; the dedup path must swallow it.
	mustIngest(t, service, span)

	got := definitionActivity(t, service, "run1")
	if len(got) != 1 || got[0].OccurrenceCount != 1 {
		t.Fatalf("duplicate ingest changed occurrence count: %+v", got)
	}
}

// TestDefinitionActivityPreservesMultipleRolesForSameDefinition proves a
// definition referenced under two distinct roles within the same run retains
// two independent rows — keyed by (run, definition, role) — each with its own
// occurrence_count, instead of collapsing into one row via min(role).
func TestDefinitionActivityPreservesMultipleRolesForSameDefinition(t *testing.T) {
	service := newTestService(t)
	mustIngest(t,
		service,
		runStartWithRefsJSON("r-start", "run1", "seg1", 1, "2026-01-01T00:00:00.000Z",
			definitionRefJSON("prompt:shared", "prompt", "resolved-prompt")),
		spanWithRefsJSON("r-span1", "run1", "seg1", 2, "sp1", "2026-01-01T00:00:01.000Z",
			definitionRefJSON("prompt:shared", "prompt", "invoked-tool")),
		spanWithRefsJSON("r-span2", "run1", "seg1", 3, "sp2", "2026-01-01T00:00:02.000Z",
			definitionRefJSON("prompt:shared", "prompt", "invoked-tool")),
	)

	got := definitionActivity(t, service, "run1")
	want := []DefinitionActivity{
		{DefinitionID: "prompt:shared", DefinitionKind: "prompt", Role: "invoked-tool", FirstSeenAt: "2026-01-01T00:00:01.000Z", LastSeenAt: "2026-01-01T00:00:02.000Z", OccurrenceCount: 2},
		{DefinitionID: "prompt:shared", DefinitionKind: "prompt", Role: "resolved-prompt", FirstSeenAt: "2026-01-01T00:00:00.000Z", LastSeenAt: "2026-01-01T00:00:00.000Z", OccurrenceCount: 1},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("multi-role definition activity mismatch:\n got %+v\nwant %+v", got, want)
	}

	filtered, err := service.RunsPage(context.Background(), RunListOptions{DefinitionID: "prompt:shared"})
	if err != nil {
		t.Fatalf("filtered runs: %v", err)
	}
	if len(filtered.Rows) != 1 || filtered.Rows[0].RunID != "run1" {
		t.Fatalf("expected exactly one run for prompt:shared despite two role rows, got %+v", filtered.Rows)
	}
}

// TestDefinitionActivityFilteredRunsQuery proves the filtered-by-definition Runs
// query returns the same {Revision, Rows, NextCursor} envelope and the correct
// rows for a definition touched by 0, 1, and N runs.
func TestDefinitionActivityFilteredRunsQuery(t *testing.T) {
	service := newTestService(t)
	mustIngest(t,
		service,
		runStartWithRefsJSON("r1-start", "run1", "seg1", 1, "2026-01-01T00:00:00.000Z",
			definitionRefJSON("prompt:shared", "prompt", "resolved-prompt"),
			definitionRefJSON("prompt:solo", "prompt", "resolved-prompt")),
		runStartWithRefsJSON("r2-start", "run2", "seg2", 1, "2026-01-02T00:00:00.000Z",
			definitionRefJSON("prompt:shared", "prompt", "resolved-prompt")),
	)

	shared, err := service.RunsPage(context.Background(), RunListOptions{DefinitionID: "prompt:shared"})
	if err != nil {
		t.Fatalf("filtered runs (shared): %v", err)
	}
	if len(shared.Rows) != 2 {
		t.Fatalf("expected 2 runs for prompt:shared, got %d", len(shared.Rows))
	}
	if shared.Revision == 0 {
		t.Fatalf("filtered runs envelope must carry the server revision, got %d", shared.Revision)
	}

	solo, err := service.RunsPage(context.Background(), RunListOptions{DefinitionID: "prompt:solo"})
	if err != nil {
		t.Fatalf("filtered runs (solo): %v", err)
	}
	if len(solo.Rows) != 1 || solo.Rows[0].RunID != "run1" {
		t.Fatalf("expected exactly run1 for prompt:solo, got %+v", solo.Rows)
	}

	none, err := service.RunsPage(context.Background(), RunListOptions{DefinitionID: "prompt:absent"})
	if err != nil {
		t.Fatalf("filtered runs (none): %v", err)
	}
	if len(none.Rows) != 0 {
		t.Fatalf("expected 0 runs for an unreferenced definition, got %+v", none.Rows)
	}
}

// TestDefinitionActivityPreservesDeletedDefinition proves activity for a
// definition that no longer exists in the Project Index is preserved (the Go
// projection never validates against the snapshot at write time) so read-time
// resolution can report it unresolved rather than silently dropping it.
func TestDefinitionActivityPreservesDeletedDefinition(t *testing.T) {
	service := newTestService(t)
	mustIngest(t,
		service,
		runStartWithRefsJSON("r-start", "run1", "seg1", 1, "2026-01-01T00:00:00.000Z",
			definitionRefJSON("prompt:since-deleted", "prompt", "resolved-prompt")),
	)
	// No Project Index is consulted; the row must exist purely from runtime.
	got := definitionActivity(t, service, "run1")
	if len(got) != 1 || got[0].DefinitionID != "prompt:since-deleted" {
		t.Fatalf("expected preserved activity for a since-deleted definition, got %+v", got)
	}
	filtered, err := service.RunsPage(context.Background(), RunListOptions{DefinitionID: "prompt:since-deleted"})
	if err != nil {
		t.Fatalf("filtered runs: %v", err)
	}
	if len(filtered.Rows) != 1 {
		t.Fatalf("filtered query must still return the run for a since-deleted definition, got %+v", filtered.Rows)
	}
}

// TestDefinitionActivityRollbackLeavesNoPartialWrite proves a failing ingest
// transaction (a conflicting sibling record) undoes the run_definition_activity
// write along with everything else — there is no separate commit path.
func TestDefinitionActivityRollbackLeavesNoPartialWrite(t *testing.T) {
	service := newTestService(t)
	batch := mustBatch(t,
		runStartWithRefsJSON("r-start", "run1", "seg1", 1, "2026-01-01T00:00:00.000Z"),
		spanWithRefsJSON("r-span", "run1", "seg1", 2, "sp1", "2026-01-01T00:00:01.000Z",
			definitionRefJSON("prompt:greeting", "prompt", "resolved-prompt")),
		// Same segment slot (seg1, seq 2) as the span above but a different
		// recordId → segment_sequence_conflict aborts the whole transaction.
		spanWithRefsJSON("r-span-conflict", "run1", "seg1", 2, "sp2", "2026-01-01T00:00:02.000Z",
			definitionRefJSON("prompt:greeting", "prompt", "resolved-prompt")),
	)
	if err := service.Ingest(context.Background(), batch); err == nil {
		t.Fatal("expected the conflicting batch to fail ingest")
	}

	got := definitionActivity(t, service, "run1")
	if len(got) != 0 {
		t.Fatalf("rolled-back transaction left partial activity: %+v", got)
	}
}

// TestDefinitionActivityDeletedWithRun proves a run's activity rows are removed
// in the same DeleteRuns path that removes the run's other records.
func TestDefinitionActivityDeletedWithRun(t *testing.T) {
	service := newTestService(t)
	mustIngest(t,
		service,
		runStartWithRefsJSON("r-start", "run1", "seg1", 1, "2026-01-01T00:00:00.000Z",
			definitionRefJSON("prompt:greeting", "prompt", "resolved-prompt")),
	)
	if _, err := service.DeleteRuns(context.Background(), []string{"run1"}); err != nil {
		t.Fatalf("delete run: %v", err)
	}
	if got := definitionActivity(t, service, "run1"); len(got) != 0 {
		t.Fatalf("deleted run left activity rows: %+v", got)
	}
	filtered, err := service.RunsPage(context.Background(), RunListOptions{DefinitionID: "prompt:greeting"})
	if err != nil {
		t.Fatalf("filtered runs: %v", err)
	}
	if len(filtered.Rows) != 0 {
		t.Fatalf("deleted run still returned by filtered query: %+v", filtered.Rows)
	}
}

// TestDefinitionActivityFollowsRetention proves retention deletion cascades to
// activity rows, with no independent TTL of its own.
func TestDefinitionActivityFollowsRetention(t *testing.T) {
	service := newTestService(t)
	mustIngest(t,
		service,
		runStartWithRefsJSON("r-start", "run1", "seg1", 1, "2000-01-01T00:00:00.000Z",
			definitionRefJSON("prompt:greeting", "prompt", "resolved-prompt")),
		// A run:end makes the run terminal so retention is eligible to reap it.
		fmt.Sprintf(`{"schemaVersion":2,"recordId":"r-end","type":"run:end","runId":"run1","segmentId":"seg1","segmentSeq":2,"endedAt":"2000-01-01T00:00:01.000Z","status":"ok"}`),
	)
	deleted, err := service.runRetention(context.Background(), retentionSettings{MaxRunAge: time.Hour, MaxRuns: 2000, PreviewMaxBytes: 1024}, time.Now().UTC())
	if err != nil {
		t.Fatalf("run retention: %v", err)
	}
	if deleted == 0 {
		t.Fatal("expected retention to reap the aged run")
	}
	if got := definitionActivity(t, service, "run1"); len(got) != 0 {
		t.Fatalf("retention left activity rows: %+v", got)
	}
}

// TestDefinitionActivityReplayRebuildsIdenticalRows proves the projection is
// derived: truncating and replaying the immutable stored records reproduces
// byte-identical activity rows.
func TestDefinitionActivityReplayRebuildsIdenticalRows(t *testing.T) {
	service := newTestService(t)
	mustIngest(t,
		service,
		runStartWithRefsJSON("r1-start", "run1", "seg1", 1, "2026-01-01T00:00:00.000Z",
			definitionRefJSON("agent:planner", "agent", "invoked-agent")),
		spanWithRefsJSON("r1-span1", "run1", "seg1", 2, "sp1", "2026-01-01T00:00:01.000Z",
			definitionRefJSON("prompt:greeting", "prompt", "resolved-prompt")),
		spanWithRefsJSON("r1-span2", "run1", "seg1", 3, "sp2", "2026-01-01T00:00:03.000Z",
			definitionRefJSON("prompt:greeting", "prompt", "resolved-prompt")),
		runStartWithRefsJSON("r2-start", "run2", "seg2", 1, "2026-01-02T00:00:00.000Z",
			definitionRefJSON("prompt:greeting", "prompt", "resolved-prompt")),
	)

	before := map[string][]DefinitionActivity{
		"run1": definitionActivity(t, service, "run1"),
		"run2": definitionActivity(t, service, "run2"),
	}

	if err := service.RebuildDefinitionActivity(context.Background()); err != nil {
		t.Fatalf("rebuild definition activity: %v", err)
	}

	for runID, want := range before {
		got := definitionActivity(t, service, runID)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("replay diverged for %s:\n got %+v\nwant %+v", runID, got, want)
		}
	}
}
