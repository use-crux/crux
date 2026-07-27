package compiler

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestPromptTextStrictDecoderRejectsUnknownABIFields(t *testing.T) {
	t.Parallel()

	raw := json.RawMessage(`{
		"id": 1,
		"ok": true,
		"response": {
			"protocolVersion": 1,
			"file": "/repo/writer.ts",
			"revision": {"openEpoch": 1, "version": 1, "sourceHash": "hash"},
			"status": {"kind": "complete"},
			"templates": [],
			"futureField": true
		},
		"error": null
	}`)
	_, err := decodeStrict[protocol.WorkerResponse[protocol.PromptTextQueryResponse]](raw)
	if err == nil || !strings.Contains(err.Error(), "futureField") {
		t.Fatalf("decodeStrict error = %v, want unknown-field rejection", err)
	}
}

func TestPromptTextStrictDecoderRejectsFieldsFromAnotherUnionVariant(t *testing.T) {
	t.Parallel()

	_, current, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test fixture path")
	}
	raw, err := os.ReadFile(filepath.Clean(filepath.Join(
		filepath.Dir(current),
		"../../../../../indexer/src/contracts/fixtures/prompt-text-query-v1.json",
	)))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Response json.RawMessage `json:"response"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	foreign := strings.Replace(
		string(fixture.Response),
		`"label": "Hello",`,
		`"label": "Hello", "markerRanges": [],`,
		1,
	)
	_, err = decodeStrict[protocol.WorkerResponse[protocol.PromptTextQueryResponse]](
		json.RawMessage(foreign),
	)
	if err == nil || !strings.Contains(err.Error(), "markerRanges") {
		t.Fatalf("decodeStrict error = %v, want foreign variant-field rejection", err)
	}
}
