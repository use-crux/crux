package protocol

import (
	"encoding/json"
	"testing"
)

func TestFoldingRangeRoundTripPinsStandardWireShape(t *testing.T) {
	t.Parallel()

	input := []byte(`{"startLine":2,"startCharacter":4,"endLine":7,"endCharacter":9}`)
	var folding FoldingRange
	if err := json.Unmarshal(input, &folding); err != nil {
		t.Fatal(err)
	}
	output, err := json.Marshal(folding)
	if err != nil {
		t.Fatal(err)
	}
	if string(output) != string(input) {
		t.Fatalf("folding range = %s, want %s", output, input)
	}

	withoutCharacters, err := json.Marshal(FoldingRange{
		StartLine: 2, EndLine: 7,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(withoutCharacters), `{"startLine":2,"endLine":7}`; got != want {
		t.Fatalf("line folding range = %s, want %s", got, want)
	}
}
