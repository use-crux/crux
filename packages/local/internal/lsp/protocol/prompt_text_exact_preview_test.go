package protocol

import (
	"encoding/json"
	"testing"
)

func TestPromptPreviewExactLinkParamsAreStrictAndComplete(t *testing.T) {
	raw := []byte(`{
		"uri":"file:///repo/source.ts",
		"openEpoch":2,
		"version":7,
		"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"position":{"line":1,"character":4}
	}`)
	var params PromptTextPreviewExactLinkParams
	if err := json.Unmarshal(raw, &params); err != nil {
		t.Fatal(err)
	}
	if params.OpenEpoch != 2 || params.Version != 7 ||
		params.Position != (Position{Line: 1, Character: 4}) {
		t.Fatalf("params = %#v", params)
	}
	for _, invalid := range [][]byte{
		[]byte(`{"uri":"file:///x","openEpoch":1,"version":0,"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","position":{"line":0,"character":0,"future":true}}`),
		[]byte(`{"uri":"file:///x","openEpoch":1,"version":0,"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","position":{"line":0,"character":0},"future":true}`),
		[]byte(`{"uri":"file:///x","openEpoch":1,"version":0,"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`),
	} {
		if err := json.Unmarshal(invalid, &params); err == nil {
			t.Fatalf("accepted invalid params: %s", invalid)
		}
	}
}
