package protocol

import (
	"encoding/json"
	"testing"
)

func TestNavigationParamsRoundTripPinWireNames(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		input  string
		params any
	}{
		{
			name:   "definition",
			input:  `{"textDocument":{"uri":"file:///repo/src/writer.ts"},"position":{"line":4,"character":8}}`,
			params: &DefinitionParams{},
		},
		{
			name:   "references",
			input:  `{"textDocument":{"uri":"file:///repo/src/writer.ts"},"position":{"line":4,"character":8},"context":{"includeDeclaration":true}}`,
			params: &ReferenceParams{},
		},
		{
			name:   "document symbol",
			input:  `{"textDocument":{"uri":"file:///repo/src/writer.ts"}}`,
			params: &DocumentSymbolParams{},
		},
		{
			name:   "workspace symbol",
			input:  `{"query":"writer"}`,
			params: &WorkspaceSymbolParams{},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := json.Unmarshal([]byte(test.input), test.params); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			output, err := json.Marshal(test.params)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if string(output) != test.input {
				t.Fatalf("params = %s, want %s", output, test.input)
			}
		})
	}
}

func TestNavigationResultsPinWireNames(t *testing.T) {
	t.Parallel()

	location := Location{
		URI: "file:///repo/src/writer.ts",
		Range: Range{
			Start: Position{Line: 4, Character: 2},
			End:   Position{Line: 4, Character: 8},
		},
	}
	tests := []struct {
		name  string
		value any
		want  string
	}{
		{
			name:  "document symbol",
			value: DocumentSymbol{Name: "writer", Detail: "prompt", Kind: SymbolKindFunction, Range: location.Range, SelectionRange: Range{Start: location.Range.Start, End: location.Range.Start}},
			want:  `{"name":"writer","detail":"prompt","kind":12,"range":{"start":{"line":4,"character":2},"end":{"line":4,"character":8}},"selectionRange":{"start":{"line":4,"character":2},"end":{"line":4,"character":2}}}`,
		},
		{
			name:  "symbol information",
			value: SymbolInformation{Name: "writer", Kind: SymbolKindFunction, Location: location, ContainerName: "repo"},
			want:  `{"name":"writer","kind":12,"location":{"uri":"file:///repo/src/writer.ts","range":{"start":{"line":4,"character":2},"end":{"line":4,"character":8}}},"containerName":"repo"}`,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			output, err := json.Marshal(test.value)
			if err != nil {
				t.Fatal(err)
			}
			if string(output) != test.want {
				t.Fatalf("result = %s, want %s", output, test.want)
			}
		})
	}
}
