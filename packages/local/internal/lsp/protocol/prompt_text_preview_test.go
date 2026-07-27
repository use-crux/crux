package protocol

import (
	"encoding/json"
	"testing"
)

func TestPromptTextPreviewStaticPositionRequestAndReadyResult(t *testing.T) {
	t.Parallel()

	const sourceHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	var params PromptTextPreviewStaticParams
	if err := json.Unmarshal([]byte(`{
		"protocolVersion":1,
		"uri":"file:///repo/writer.ts",
		"openEpoch":2,
		"version":7,
		"sourceHash":"`+sourceHash+`",
		"target":{"kind":"position","position":{"line":3,"character":4}}
	}`), &params); err != nil {
		t.Fatalf("decode params: %v", err)
	}
	if params.Target.Kind != PromptTextPreviewTargetPosition ||
		params.Target.Position == nil ||
		params.Target.Position.Line != 3 ||
		params.Target.Position.Character != 4 {
		t.Fatalf("params target = %#v", params.Target)
	}

	encoded, err := json.Marshal(PromptTextPreviewReadyResult{
		PromptTextPreviewResultStamp: PromptTextPreviewResultStamp{
			ProtocolVersion: PromptTextProtocolVersion,
			URI:             "file:///repo/writer.ts",
			OpenEpoch:       2,
			Version:         7,
			SourceHash:      sourceHash,
		},
		Kind: PromptTextPreviewResultReady,
		Selection: PromptTextPreviewSelection{
			Ordinal: 0,
			Range: Range{
				Start: Position{Line: 3, Character: 1},
				End:   Position{Line: 5, Character: 2},
			},
		},
		RequestStatus:  PromptTextPreviewStructuralComplete,
		TemplateStatus: PromptTextPreviewStructuralComplete,
		PreviewStatus:  PromptTextPreviewContentComplete,
		Evidence:       PromptTextPreviewEvidenceSyntaxExact,
		Text:           "# Hello\n",
	})
	if err != nil {
		t.Fatal(err)
	}
	const expected = `{"protocolVersion":1,"uri":"file:///repo/writer.ts","openEpoch":2,"version":7,"sourceHash":"` + sourceHash + `","kind":"ready","selection":{"ordinal":0,"range":{"start":{"line":3,"character":1},"end":{"line":5,"character":2}}},"requestStatus":"complete","templateStatus":"complete","previewStatus":"complete","evidence":"syntax-exact","text":"# Hello\n"}`
	if string(encoded) != expected {
		t.Fatalf("ready JSON = %s\nwant       = %s", encoded, expected)
	}
}

func TestPromptTextPreviewStaticParamsRejectUnknownFieldsRecursively(t *testing.T) {
	t.Parallel()

	const base = `{
		"protocolVersion":1,
		"uri":"file:///repo/writer.ts",
		"openEpoch":2,
		"version":7,
		"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"target":{"kind":"position","position":{"line":3,"character":4}}
	}`
	for _, input := range []string{
		`{"protocolVersion":1,"uri":"file:///repo/writer.ts","openEpoch":2,"version":7,"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","target":{"kind":"position","position":{"line":3,"character":4}},"foreign":true}`,
		`{"protocolVersion":1,"uri":"file:///repo/writer.ts","openEpoch":2,"version":7,"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","target":{"kind":"position","position":{"line":3,"character":4},"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":1}}}}`,
		`{"protocolVersion":1,"uri":"file:///repo/writer.ts","openEpoch":2,"version":7,"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","target":{"kind":"position","position":{"line":3,"character":4,"foreign":true}}}`,
		`{"protocolVersion":1,"uri":"file:///repo/writer.ts","openEpoch":2,"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","target":{"kind":"position","position":{"line":3,"character":4}}}`,
		`{"protocolVersion":1,"uri":"file:///repo/writer.ts","openEpoch":2,"version":7,"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","target":{"kind":"position","position":{}}}`,
		`{"protocolVersion":1,"uri":"file:///repo/writer.ts","openEpoch":2,"version":7,"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","target":{"kind":"position","position":{"line":0}}}`,
		`{"protocolVersion":1,"uri":"file:///repo/writer.ts","openEpoch":2,"version":7,"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","target":{"kind":"template-range","range":{"start":{"line":0,"character":0},"end":{"line":0}}}}`,
	} {
		var params PromptTextPreviewStaticParams
		if err := json.Unmarshal([]byte(input), &params); err == nil {
			t.Fatalf("accepted foreign params:\n%s", input)
		}
	}

	var params PromptTextPreviewStaticParams
	if err := json.Unmarshal([]byte(base), &params); err != nil {
		t.Fatalf("exact params rejected: %v", err)
	}
}
