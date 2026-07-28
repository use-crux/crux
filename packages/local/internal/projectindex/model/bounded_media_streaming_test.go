package model

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestBoundedMediaStreamingFactsRoundTripThroughGoModel(t *testing.T) {
	metadata := []json.RawMessage{
		json.RawMessage(`{"facts":{"kind":"media.operation","operation":"streamImage","outputModalities":["image"],"adapter":"openai","execution":"native","authoredOptions":{"n":1}}}`),
		json.RawMessage(`{"facts":{"kind":"media.operation","operation":"streamSpeech","inputModalities":["text"],"outputModalities":["audio"],"adapter":"google","execution":"native","authoredOptions":{"voice":"Kore"}}}`),
	}
	patch := IndexPatch{
		SchemaVersion: 2,
		Phase:         PhaseSemantic,
		Project:       store.ProjectIdentity{Root: "/repo", Name: "media"},
		Status:        "ok",
		Facts: IndexPatchFacts{
			Definitions: []store.ProjectDefinition{
				{ID: "media.operation:image", Kind: "media.operation", Name: "image", Fidelity: "resolved", Status: "active", Metadata: metadata[0]},
				{ID: "media.operation:speech", Kind: "media.operation", Name: "speech", Fidelity: "resolved", Status: "active", Metadata: metadata[1]},
			},
		},
	}

	facts, err := indexPatchFactsFromEnvelopes(FactTransactionFromPatch(patch).Facts)
	if err != nil {
		t.Fatalf("round trip bounded media facts: %v", err)
	}
	if len(facts.Definitions) != 2 {
		t.Fatalf("definitions = %d, want 2", len(facts.Definitions))
	}
	for index, definition := range facts.Definitions {
		if !bytes.Equal(definition.Metadata, metadata[index]) {
			t.Fatalf("definition %d metadata = %s, want %s", index, definition.Metadata, metadata[index])
		}
	}
	encoded, err := json.Marshal(facts)
	if err != nil {
		t.Fatalf("marshal bounded media facts: %v", err)
	}
	for _, forbidden := range []string{"prompt", "bytes", "url", "filename", "fileId", "nativeEvent"} {
		if bytes.Contains(encoded, []byte(forbidden)) {
			t.Fatalf("bounded media facts contain forbidden %q: %s", forbidden, encoded)
		}
	}
}
