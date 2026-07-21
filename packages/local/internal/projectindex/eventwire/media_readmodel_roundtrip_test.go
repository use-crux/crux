package eventwire

import (
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	projectmodel "github.com/use-crux/crux/packages/local/internal/projectindex/model"
	projectreadmodel "github.com/use-crux/crux/packages/local/internal/projectindex/readmodel"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type mediaRoundTripSource struct{ index store.IndexData }

func (s mediaRoundTripSource) Snapshot() store.IndexData {
	return s.index
}

func TestMediaFactsPreserveRawJSONThroughEventReadModelAndAPI(t *testing.T) {
	events := []json.RawMessage{
		json.RawMessage(`{"protocolVersion":3,"type":"phase:start","transactionId":"media-round-trip","phase":"ast","root":"/repo","startedAt":"2026-07-12T00:00:00Z"}`),
		json.RawMessage(`{"protocolVersion":3,"type":"fact:batch","transactionId":"media-round-trip","sequence":0,"facts":[{"schemaVersion":1,"factId":"definitions:media.operation:thumbnail","kind":"definitions","phase":"ast","projectRoot":"/repo","producer":{"name":"@use-crux/indexer","version":"test"},"fidelity":"authoritative","provenance":{"kind":"source","file":"src/media.ts"},"fact":{"id":"media.operation:thumbnail","kind":"media.operation","name":"thumbnail","fidelity":"resolved","status":"active","metadata":{"operation":"image.generate","limit":9007199254740993,"future":{"preserve":true}}}},{"schemaVersion":1,"factId":"definitions:ingest.source:uploads","kind":"definitions","phase":"ast","projectRoot":"/repo","producer":{"name":"@use-crux/indexer","version":"test"},"fidelity":"authoritative","provenance":{"kind":"source","file":"src/ingest.ts"},"fact":{"id":"ingest.source:uploads","kind":"ingest.source","name":"uploads","fidelity":"resolved","status":"active","metadata":{"sourceType":"multipart","accept":["image/*","audio/*"],"future":{"preserve":true}}}},{"schemaVersion":1,"factId":"relations:media.derives_with","kind":"relations","phase":"ast","projectRoot":"/repo","producer":{"name":"@use-crux/indexer","version":"test"},"fidelity":"inferred","provenance":{"kind":"source","file":"src/ingest.ts"},"fact":{"id":"relation:media.derives_with:uploads:thumbnail","type":"media.derives_with","from":"ingest.source:uploads","to":"media.operation:thumbnail","fidelity":"resolved","metadata":{"mode":"async","limit":9007199254740993}}},{"schemaVersion":1,"factId":"lintFindings:media.unsafe_input","kind":"lintFindings","phase":"ast","projectRoot":"/repo","producer":{"name":"@use-crux/indexer","version":"test"},"fidelity":"inferred","provenance":{"kind":"source","file":"src/ingest.ts"},"fact":{"id":"lint:media.unsafe_input:uploads","severity":"warning","ruleId":"media.unsafe_input","category":"safety","maturity":"preview","confidence":"high","profiles":["recommended"],"title":"Validate media input","message":"Validate uploads.","rationale":"Media input is untrusted.","evidence":[{"kind":"definition","label":"Upload source","definitionId":"ingest.source:uploads","data":{"allowedBytes":9007199254740993,"future":{"preserve":true}}}],"fixes":[]}}]}`),
		json.RawMessage(`{"protocolVersion":3,"type":"phase:done","transactionId":"media-round-trip","phase":"ast","patch":{"schemaVersion":1,"phase":"ast","project":{"root":"/repo","name":"media"},"startedAt":"2026-07-12T00:00:00Z","finishedAt":"2026-07-12T00:00:01Z","status":"ok"},"summary":{"factCount":4}}`),
	}

	collector := NewProjectIndexPatchStreamCollector(ProjectIndexPatchStreamOptions{
		Root: "/repo", Producer: "@use-crux/indexer", MaxFactsPerBatch: 4,
	})
	for _, event := range events {
		if err := collector.Handle(event); err != nil {
			t.Fatalf("Handle(%s) error = %v", event, err)
		}
	}
	patches, err := collector.Patches()
	if err != nil {
		t.Fatalf("Patches error = %v", err)
	}
	if len(patches) != 1 {
		t.Fatalf("patches len = %d, want 1", len(patches))
	}

	state := projectmodel.ApplyPatch(projectmodel.EmptyPatchState(), patches[0])
	index := projectreadmodel.New(mediaRoundTripSource{index: state.Index}).Index()
	assertMediaRawMessages(t, index.Definitions, index.Relations, index.LintFindings)

	encoded, err := json.Marshal(index)
	if err != nil {
		t.Fatalf("marshal read model: %v", err)
	}
	var apiIndex api.IndexData
	if err := json.Unmarshal(encoded, &apiIndex); err != nil {
		t.Fatalf("decode API index: %v", err)
	}
	assertAPIMediaRawMessages(t, apiIndex)
}

func assertMediaRawMessages(t *testing.T, definitions []store.ProjectDefinition, relations []store.ProjectRelation, findings []store.IndexLintFinding) {
	t.Helper()
	if len(definitions) != 2 || string(definitions[0].Metadata) != `{"operation":"image.generate","limit":9007199254740993,"future":{"preserve":true}}` || string(definitions[1].Metadata) != `{"sourceType":"multipart","accept":["image/*","audio/*"],"future":{"preserve":true}}` {
		t.Fatalf("definition metadata lost raw JSON: %s / %s", definitions[0].Metadata, definitions[1].Metadata)
	}
	if len(relations) != 1 || string(relations[0].Metadata) != `{"mode":"async","limit":9007199254740993}` {
		t.Fatalf("relation metadata lost raw JSON: %+v", relations)
	}
	if len(findings) != 1 || len(findings[0].Evidence) != 1 || string(findings[0].Evidence[0].Data) != `{"allowedBytes":9007199254740993,"future":{"preserve":true}}` {
		t.Fatalf("lint evidence lost raw JSON: %+v", findings)
	}
}

func assertAPIMediaRawMessages(t *testing.T, index api.IndexData) {
	t.Helper()
	if len(index.Definitions) != 2 || string(index.Definitions[0].Metadata) != `{"operation":"image.generate","limit":9007199254740993,"future":{"preserve":true}}` || string(index.Definitions[1].Metadata) != `{"sourceType":"multipart","accept":["image/*","audio/*"],"future":{"preserve":true}}` {
		t.Fatalf("API definition metadata lost raw JSON: %s / %s", index.Definitions[0].Metadata, index.Definitions[1].Metadata)
	}
	if len(index.Relations) != 1 || string(index.Relations[0].Metadata) != `{"mode":"async","limit":9007199254740993}` {
		t.Fatalf("API relation metadata lost raw JSON: %+v", index.Relations)
	}
	if len(index.LintFindings) != 1 || len(index.LintFindings[0].Evidence) != 1 || string(index.LintFindings[0].Evidence[0].Data) != `{"allowedBytes":9007199254740993,"future":{"preserve":true}}` {
		t.Fatalf("API lint evidence lost raw JSON: %+v", index.LintFindings)
	}
}
