package manifestcontract

import "testing"

func TestValidDefinitionKindAcceptsEmbeddingDefinitions(t *testing.T) {
	t.Parallel()

	for _, kind := range []string{"embedding", "embedding.call", "rag.indexer"} {
		kind := kind
		t.Run(kind, func(t *testing.T) {
			t.Parallel()
			if !validDefinitionKind(kind) {
				t.Fatalf("expected %q to be a valid deployment manifest definition kind", kind)
			}
		})
	}
}
