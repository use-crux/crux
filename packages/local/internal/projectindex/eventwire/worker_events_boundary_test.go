package eventwire_test

import (
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/eventwire"
)

func TestPatchStreamCollectorDecodesContractFixtureEvents(t *testing.T) {
	collector := eventwire.NewProjectIndexPatchStreamCollector(eventwire.ProjectIndexPatchStreamOptions{
		Root:             "/repo",
		Producer:         "@use-crux/indexer",
		MaxFactsPerBatch: 2,
	})

	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"protocolVersion":2,"type":"phase:start","transactionId":"tx-contract-spine-ast","phase":"ast","root":"/repo","startedAt":"2026-06-24T10:00:00.000Z"}`),
		json.RawMessage(`{"protocolVersion":2,"type":"fact:batch","transactionId":"tx-contract-spine-ast","sequence":0,"facts":[{"schemaVersion":1,"factId":"definitions:prompt:contract-spine","kind":"definitions","phase":"ast","projectRoot":"/repo","producer":{"name":"@use-crux/indexer","version":"contract-spine"},"fidelity":"inferred","provenance":{"kind":"source","file":"/repo/src/contract.ts"},"fact":{"id":"prompt:contract-spine","kind":"prompt","name":"contractSpine","fidelity":"partial","status":"active","source":{"file":"/repo/src/contract.ts","line":2}}},{"schemaVersion":1,"factId":"diagnostics:diagnostic:contract-spine","kind":"diagnostics","phase":"ast","projectRoot":"/repo","producer":{"name":"@use-crux/indexer","version":"contract-spine"},"fidelity":"inferred","provenance":{"kind":"source","file":"/repo/src/contract.ts"},"fact":{"id":"diagnostic:contract-spine","severity":"info","code":"index.contract","message":"contract fixture indexed","source":{"file":"/repo/src/contract.ts","line":2}}}]}`),
		json.RawMessage(`{"protocolVersion":2,"type":"sourceProfile:batch","transactionId":"tx-contract-spine-ast","sequence":0,"files":[{"file":"/repo/src/contract.ts","sourceHash":"sha256:contract","sourceBytes":42,"hints":{"nativeDirectCruxCandidate":true,"cruxCallNames":["prompt"]}}]}`),
		json.RawMessage(`{"protocolVersion":2,"type":"phase:done","transactionId":"tx-contract-spine-ast","phase":"ast","patch":{"schemaVersion":1,"phase":"ast","project":{"root":"/repo","name":"contract-spine","configFile":"crux.config.ts"},"startedAt":"2026-06-24T10:00:00.000Z","finishedAt":"2026-06-24T10:00:00.010Z","status":"ok","invalidates":{"all":true}},"summary":{"factCount":2}}`),
	} {
		if err := collector.Handle(raw); err != nil {
			t.Fatalf("Handle(%s) error = %v", raw, err)
		}
	}

	patches, err := collector.Patches()
	if err != nil {
		t.Fatalf("Patches error = %v", err)
	}
	if len(patches) != 1 {
		t.Fatalf("patches len = %d, want 1", len(patches))
	}
	patch := patches[0]
	if patch.Project.Root != "/repo" || patch.Project.Name != "contract-spine" {
		t.Fatalf("project = %+v, want contract-spine fixture", patch.Project)
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:contract-spine" {
		t.Fatalf("definitions = %+v, want contract fixture definition", patch.Facts.Definitions)
	}
	if patch.SemanticSourceProfile == nil || patch.SemanticSourceProfile.SourceBytes != 42 {
		t.Fatalf("semantic source profile = %+v, want 42 bytes", patch.SemanticSourceProfile)
	}
}
