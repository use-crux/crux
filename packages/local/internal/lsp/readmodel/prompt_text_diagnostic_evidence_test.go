package readmodel

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

const promptTextEvidenceJSON = `{
	"kind":"prompt-text",
	"sourceRefId":"prompt:writer:source:prompt",
	"interpolationIndex":0,
	"proof":"semantic-exact",
	"cause":{"kind":"invalid-interpolation","runtimeKinds":["bigint","symbol"]}
}`

func TestPromptTextDiagnosticEvidenceSurvivesSnapshotAndDetachedPublication(t *testing.T) {
	t.Parallel()

	const file = "/repo/prompt.ts"
	snapshot, err := decodeSnapshot([]byte(`{
		"generation":7,
		"diagnostics":[{
			"id":"prompt-text:unsupported-runtime-kind",
			"severity":"warning",
			"code":"prompt-text.unsupported-runtime-kind",
			"message":"Unsupported PromptText interpolation runtime kind.",
			"source":{"file":"` + file + `","line":1},
			"evidence":` + promptTextEvidenceJSON + `
		}],
		"sources":[{
			"file":"` + file + `",
			"status":"indexed",
			"sourceHash":"sha256:prompt"
		}]
	}`))
	if err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}

	store := NewStore()
	store.ApplySnapshot("scope", snapshot)
	publication := store.PublicationSnapshot("scope")
	diagnostic := publication.Diagnostics[file][0]
	assertJSONEqual(t, diagnostic.Evidence, []byte(promptTextEvidenceJSON))
	if got := publication.SourcesByFile[file].SourceHash; got != "sha256:prompt" {
		t.Fatalf("source hash = %q, want sha256:prompt", got)
	}

	diagnostic.Evidence[0] = '['
	again := store.PublicationSnapshot("scope")
	assertJSONEqual(t, again.Diagnostics[file][0].Evidence, []byte(promptTextEvidenceJSON))
}

func TestPromptTextDiagnosticEvidenceFollowsPerFileReplacementSemantics(t *testing.T) {
	t.Parallel()

	const file = "/repo/prompt.ts"
	generation := uint64(1)
	store := NewStore()
	store.ApplySnapshot("scope", Snapshot{
		Generation: &generation,
		Diagnostics: []api.IndexDiagnostic{promptTextDiagnostic(
			file,
			"prompt-text:before",
			json.RawMessage(promptTextEvidenceJSON),
		)},
	})

	omitted := store.ApplyDelta("scope", Delta{Generation: 2, File: file})
	if omitted.Status != DeltaApplied || len(omitted.ChangedFiles) != 0 {
		t.Fatalf("omitted result = %#v, want no diagnostic change", omitted)
	}
	assertDiagnosticIDs(t, store.PublicationSnapshot("scope").Diagnostics[file], []string{
		"prompt-text:before",
	})

	replacementEvidence := json.RawMessage(`{
		"kind":"prompt-text",
		"sourceRefId":"prompt:writer:source:prompt",
		"interpolationIndex":1,
		"proof":"semantic-exact",
		"cause":{"kind":"inline-sequence","joinableWithComma":true}
	}`)
	replaced := store.ApplyDelta("scope", Delta{
		Generation: 3,
		File:       file,
		Diagnostics: []api.IndexDiagnostic{promptTextDiagnostic(
			file,
			"prompt-text:after",
			replacementEvidence,
		)},
	})
	if replaced.Status != DeltaApplied {
		t.Fatalf("replacement status = %v, want applied", replaced.Status)
	}
	publication := store.PublicationSnapshot("scope")
	assertDiagnosticIDs(t, publication.Diagnostics[file], []string{"prompt-text:after"})
	assertJSONEqual(t, publication.Diagnostics[file][0].Evidence, replacementEvidence)

	cleared := store.ApplyDelta("scope", Delta{
		Generation:  4,
		File:        file,
		Diagnostics: []api.IndexDiagnostic{},
	})
	if cleared.Status != DeltaApplied {
		t.Fatalf("clear status = %v, want applied", cleared.Status)
	}
	if diagnostics := store.PublicationSnapshot("scope").Diagnostics[file]; len(diagnostics) != 0 {
		t.Fatalf("diagnostics = %#v, want cleared", diagnostics)
	}
}

func promptTextDiagnostic(
	file string,
	id string,
	evidence json.RawMessage,
) api.IndexDiagnostic {
	return api.IndexDiagnostic{
		ID:       id,
		Code:     "prompt-text.unsupported-runtime-kind",
		Source:   &api.SourceLoc{File: file, Line: 1},
		Evidence: evidence,
	}
}

func assertDiagnosticIDs(
	t *testing.T,
	diagnostics []api.IndexDiagnostic,
	want []string,
) {
	t.Helper()
	got := make([]string, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		got = append(got, diagnostic.ID)
	}
	if len(got) != len(want) {
		t.Fatalf("diagnostic IDs = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("diagnostic IDs = %v, want %v", got, want)
		}
	}
}

func assertJSONEqual(t *testing.T, got, want []byte) {
	t.Helper()
	var gotValue any
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatalf("decode got JSON %q: %v", got, err)
	}
	var wantValue any
	if err := json.Unmarshal(want, &wantValue); err != nil {
		t.Fatalf("decode want JSON %q: %v", want, err)
	}
	gotJSON, _ := json.Marshal(gotValue)
	wantJSON, _ := json.Marshal(wantValue)
	if !bytes.Equal(gotJSON, wantJSON) {
		t.Fatalf("JSON = %s, want %s", gotJSON, wantJSON)
	}
}
