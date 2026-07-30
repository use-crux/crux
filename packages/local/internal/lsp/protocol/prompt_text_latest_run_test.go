package protocol

import (
	"encoding/json"
	"testing"
)

func TestPromptTextOpenLatestRunLinkWireIsStrictAndDistinct(t *testing.T) {
	raw := []byte(`{
		"uri":"file:///repo/source.ts",
		"openEpoch":2,
		"version":7,
		"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"position":{"line":1,"character":4}
	}`)
	var params PromptTextOpenLatestRunLinkParams
	if err := json.Unmarshal(raw, &params); err != nil {
		t.Fatal(err)
	}
	if params.OpenEpoch != 2 || params.Version != 7 ||
		params.Position != (Position{Line: 1, Character: 4}) {
		t.Fatalf("params = %#v", params)
	}
	if err := json.Unmarshal(
		[]byte(`{
			"uri":"file:///repo/source.ts",
			"openEpoch":2,
			"version":7,
			"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"position":{"line":1,"character":4},
			"future":true
		}`),
		&params,
	); err == nil {
		t.Fatal("accepted unknown latest-Run link field")
	}

	encoded, err := json.Marshal(PromptTextOpenLatestRunLinkReadyResult{
		Kind: PromptTextOpenLatestRunLinkReady,
		URL:  "http://localhost:7821/library/index/prompt/prompt%3Agreeting/latest-run",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"kind":"ready","url":"http://localhost:7821/library/index/prompt/prompt%3Agreeting/latest-run"}`
	if string(encoded) != want {
		t.Fatalf("ready result = %s, want %s", encoded, want)
	}
	if MethodPromptTextOpenLatestRunLink == MethodPromptTextPreviewExactLink {
		t.Fatal("latest-Run and exact-preview requests share a method")
	}
}
