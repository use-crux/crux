package readmodel

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestDecodeSnapshotPreservesGenerationPresence(t *testing.T) {
	snapshot, err := decodeSnapshot([]byte(`{
      "type":"index",
      "projectRoot":"/repo",
      "serverVersion":"v1",
      "generation":0,
      "prompts":[],"contexts":[],"tools":[],
      "lintFindings":[{"id":"lint-1","ruleId":"test.rule","source":{"file":"/repo/a.ts","line":1}}]
    }`))
	if err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}
	if snapshot.Generation == nil || *snapshot.Generation != 0 {
		t.Fatalf("generation = %v, want present zero", snapshot.Generation)
	}
	if snapshot.ProjectRoot != "/repo" || snapshot.ServerVersion != "v1" {
		t.Fatalf("metadata = (%q, %q)", snapshot.ProjectRoot, snapshot.ServerVersion)
	}
	assertFindingIDs(t, snapshot.Findings, []string{"lint-1"})
	if len(snapshot.Definitions) != 0 {
		t.Fatalf("definitions = %#v, want empty", snapshot.Definitions)
	}

	legacy, err := decodeSnapshot([]byte(`{"prompts":[],"contexts":[],"tools":[],"project":{"root":"/repo"}}`))
	if err != nil {
		t.Fatalf("decode legacy snapshot: %v", err)
	}
	if legacy.Generation != nil {
		t.Fatalf("legacy generation = %v, want absent", *legacy.Generation)
	}
	if legacy.ProjectRoot != "/repo" {
		t.Fatalf("legacy project root = %q, want project.root fallback", legacy.ProjectRoot)
	}
}

func TestSnapshotFromIndexRetainsRelations(t *testing.T) {
	snapshot := snapshotFromIndex(api.IndexData{Relations: []api.ProjectRelation{{ID: "relation:one"}}})
	if len(snapshot.Relations) != 1 || snapshot.Relations[0].ID != "relation:one" {
		t.Fatalf("relations = %#v, want relation:one", snapshot.Relations)
	}
}

func TestDecodeWSMessageDistinguishesOmittedAndEmptyLints(t *testing.T) {
	omitted, ok, err := decodeWSMessage([]byte(`{"type":"index:delta","generation":3,"file":"/repo/a.ts"}`))
	if err != nil || !ok {
		t.Fatalf("decode omitted delta = (%#v, %v, %v)", omitted, ok, err)
	}
	if omitted.Delta == nil || omitted.Delta.Lints != nil {
		t.Fatalf("omitted lints decoded as %#v", omitted.Delta)
	}

	empty, ok, err := decodeWSMessage([]byte(`{"type":"index:delta","generation":3,"file":"","lints":{"findings":[]}}`))
	if err != nil || !ok {
		t.Fatalf("decode clear delta = (%#v, %v, %v)", empty, ok, err)
	}
	if empty.Delta == nil || empty.Delta.Lints == nil || empty.Delta.Lints.Findings == nil {
		t.Fatalf("empty lints decoded as %#v", empty.Delta)
	}
	if empty.Delta.File != "" {
		t.Fatalf("project anchor = %q, want empty", empty.Delta.File)
	}
}

func TestDecodeWSMessageRetainsDefinitionChanges(t *testing.T) {
	message, ok, err := decodeWSMessage([]byte(`{
      "type":"index:delta","generation":4,"file":"/repo/a.ts",
      "definitions":{"added":[],"changed":[{"id":"prompt:writer","kind":"prompt","name":"writer","fidelity":"resolved"}],"removedIds":["prompt:old"]}
    }`))
	if err != nil || !ok || message.Delta == nil {
		t.Fatalf("definition delta = (%#v, %v, %v)", message, ok, err)
	}
	if len(message.Delta.Definitions.Changed) != 1 || message.Delta.Definitions.Changed[0].ID != "prompt:writer" ||
		len(message.Delta.Definitions.RemovedIDs) != 1 {
		t.Fatalf("definition changes = %#v", message.Delta.Definitions)
	}
}

func TestDecodeWSMessageRetainsSourceRowPresence(t *testing.T) {
	present, ok, err := decodeWSMessage([]byte(`{
      "type":"index:delta","generation":4,"file":"/repo/a.ts",
      "sourceRow":{"file":"/repo/a.ts","hash":"next"}
    }`))
	if err != nil || !ok || present.Delta == nil || !present.Delta.SourceChanged {
		t.Fatalf("source-row delta = (%#v, %v, %v), want source change", present, ok, err)
	}

	omitted, ok, err := decodeWSMessage([]byte(`{
      "type":"index:delta","generation":5,"file":"/repo/a.ts"
    }`))
	if err != nil || !ok || omitted.Delta == nil || omitted.Delta.SourceChanged {
		t.Fatalf("omitted source row = (%#v, %v, %v), want no source change", omitted, ok, err)
	}
}

func TestDecodeWSMessageIgnoresUnrelatedTraffic(t *testing.T) {
	message, ok, err := decodeWSMessage([]byte(`{"type":"runtime:snapshot","generation":99}`))
	if err != nil || ok || message.Snapshot != nil || message.Delta != nil {
		t.Fatalf("unrelated message = (%#v, %v, %v), want ignored", message, ok, err)
	}
}
