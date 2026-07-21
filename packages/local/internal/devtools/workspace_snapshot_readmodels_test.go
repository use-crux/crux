package devtools

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestWorkspaceSnapshotOperationsDoNotMutateFileCatalog(t *testing.T) {
	classes := map[string]workspaceOperationClass{
		"snapshot.create":  workspaceOperationSnapshotAccess,
		"snapshot.list":    workspaceOperationSnapshotAccess,
		"snapshot.restore": workspaceOperationSnapshotLiveTreeMutation,
		"snapshot.delete":  workspaceOperationSnapshotStorageMutation,
	}
	for operation, want := range classes {
		if got := classifyWorkspaceOperation(operation); got != want {
			t.Fatalf("classifyWorkspaceOperation(%q) = %q, want %q", operation, got, want)
		}
		if workspaceOperationAffectsFileCatalog(operation) {
			t.Fatalf("workspaceOperationAffectsFileCatalog(%q) = true", operation)
		}
	}

	size := 42
	events := []store.WorkspaceEventData{
		{
			TraceID: "trace-file", Timestamp: 1, WorkspaceID: "drafts",
			Namespace: "tenant-hash", Operation: "write", Path: "/drafts/report.md",
			PathHash: "path-file", Status: "success", Size: &size,
		},
	}
	for index, operation := range []string{
		"snapshot.create",
		"snapshot.list",
		"snapshot.restore",
		"snapshot.delete",
	} {
		events = append(events, store.WorkspaceEventData{
			TraceID: "trace-" + operation, Timestamp: int64(index + 2),
			WorkspaceID: "drafts", Namespace: "tenant-hash", Operation: operation,
			Path: "hash:path-private", PathHash: "path-private", Status: "success",
		})
	}

	files := workspaceFilesFromEvents(events)
	if len(files) != 1 {
		t.Fatalf("files = %#v, want only the real file", files)
	}
	if files[0].Path != "/drafts/report.md" || files[0].Op != "write" || files[0].OperationCount != 1 || files[0].Size == nil || *files[0].Size != size {
		t.Fatalf("real file summary changed by snapshot operations: %#v", files[0])
	}

	ops := workspaceOpsFromEvents(events)
	if len(ops) != 5 {
		t.Fatalf("recent ops = %#v, want file and four snapshot operations", ops)
	}
	seen := map[string]bool{}
	for _, op := range ops {
		seen[op.Op] = true
	}
	for _, operation := range []string{"snapshot.create", "snapshot.list", "snapshot.restore", "snapshot.delete"} {
		if !seen[operation] {
			t.Fatalf("recent ops = %#v, missing %s", ops, operation)
		}
	}

	summary := workspaceSummaryFromEvents("drafts", events)
	if summary.Stats.Operations != 5 || len(summary.Mounts) != 1 || summary.Mounts[0].FileCount != 1 {
		t.Fatalf("workspace summary = %#v, want all operations and one real file", summary)
	}
}

func TestWorkspaceAggregateOperationsDoNotBecomeFiles(t *testing.T) {
	events := []store.WorkspaceEventData{
		{TraceID: "trace-list", Timestamp: 1, Operation: "list", Path: "/drafts"},
		{TraceID: "trace-grep", Timestamp: 2, Operation: "grep", Path: "/drafts"},
		{TraceID: "trace-artifacts", Timestamp: 3, Operation: "artifacts", Path: "/drafts/report.md"},
		{TraceID: "trace-transaction", Timestamp: 4, Operation: "transaction", Path: "/drafts/report.md"},
	}

	if files := workspaceFilesFromEvents(events); len(files) != 0 {
		t.Fatalf("aggregate Workspace operations created file rows: %#v", files)
	}
}

func TestWorkspaceSnapshotActivityPreservesSafeAggregates(t *testing.T) {
	activity := []observability.ResourceActivity{
		snapshotActivity("snapshot.create", "path-create", `"fileCount":2,"sizeBytes":64`),
		snapshotActivity("snapshot.list", "path-list", `"snapshotCount":3`),
		snapshotActivity("snapshot.restore", "path-restore", `"restoredFiles":4,"deletedFiles":1,"unchangedFiles":2`),
		snapshotActivity("snapshot.delete", "path-delete", ``),
	}

	events := workspaceEventsFromActivity(activity)
	if len(events) != 4 {
		t.Fatalf("events = %#v, want all four snapshot operations", events)
	}
	for _, event := range events {
		if event.Path != "" {
			t.Fatalf("snapshot event path = %q, want no synthetic file path", event.Path)
		}
		if event.PathHash == "" || event.Namespace != "namespace-hash" {
			t.Fatalf("snapshot privacy fields = %#v", event)
		}
		if event.Size != nil {
			t.Fatalf("snapshot event size = %v, aggregate sizeBytes must not become file size", event.Size)
		}
	}

	encoded, err := json.Marshal(workspaceOpsFromEvents(events))
	if err != nil {
		t.Fatal(err)
	}
	text := string(encoded)
	for _, fragment := range []string{
		`"op":"snapshot.create"`, `"fileCount":2`, `"sizeBytes":64`,
		`"op":"snapshot.list"`, `"snapshotCount":3`,
		`"op":"snapshot.restore"`, `"restoredFiles":4`, `"deletedFiles":1`, `"unchangedFiles":2`,
		`"op":"snapshot.delete"`, `"pathHash":"path-delete"`,
	} {
		if !strings.Contains(text, fragment) {
			t.Fatalf("workspace ops JSON = %s, missing %s", text, fragment)
		}
	}
}

func TestWorkspaceSnapshotActivityProjectsOnlySafeFailureCode(t *testing.T) {
	failed := snapshotActivity("snapshot.restore", "path-private", ``)
	failed.Status = "error"
	failed.Attributes = json.RawMessage(`{
		"workspaceId":"drafts",
		"namespaceHash":"namespace-hash",
		"operation":"snapshot.restore",
		"pathHash":"path-private",
		"path":"/drafts/private.md",
		"uri":"asset://private",
		"mimeType":"application/private",
		"artifactStatus":"final",
		"artifactKind":"manifest"
	}`)
	failed.Error = json.RawMessage(`{
		"name":"WorkspaceSnapshotError",
		"category":"corrupt_snapshot",
		"message":"private /drafts path snapshot-id-123 asset://private"
	}`)

	events := workspaceEventsFromActivity([]observability.ResourceActivity{failed})
	encoded, err := json.Marshal(workspaceOpsFromEvents(events))
	if err != nil {
		t.Fatal(err)
	}
	text := string(encoded)
	for _, fragment := range []string{`"status":"err"`, `"errorCode":"corrupt_snapshot"`} {
		if !strings.Contains(text, fragment) {
			t.Fatalf("workspace failure JSON = %s, missing %s", text, fragment)
		}
	}
	for _, private := range []string{"/drafts", "snapshot-id-123", "asset://private", "application/private", "manifest"} {
		if strings.Contains(text, private) {
			t.Fatalf("workspace failure JSON leaked %q: %s", private, text)
		}
	}
}

func snapshotActivity(operation, pathHash, aggregates string) observability.ResourceActivity {
	separator := ""
	if aggregates != "" {
		separator = ","
	}
	return observability.ResourceActivity{
		TraceID: "trace-" + operation, ResourceID: "drafts", Primitive: "workspace.operation",
		Name: "workspace." + operation, Status: "ok", StartedAt: "2026-07-21T12:00:00.000Z",
		Attributes: json.RawMessage(`{"workspaceId":"drafts","namespaceHash":"namespace-hash","operation":"` + operation + `","pathHash":"` + pathHash + `"` + separator + aggregates + `}`),
	}
}
