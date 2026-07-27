package protocol

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

func TestPromptTextV1DecodesTheSharedGoldenABI(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile(promptTextGoldenFixturePath(t))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Request  PromptTextWorkerRequest                 `json:"request"`
		Response WorkerResponse[PromptTextQueryResponse] `json:"response"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&fixture); err != nil {
		t.Fatalf("decode golden PromptText ABI: %v", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		t.Fatalf("decode trailing golden PromptText ABI data: %v", err)
	}
	encoded, err := json.Marshal(fixture)
	if err != nil {
		t.Fatalf("encode golden PromptText ABI: %v", err)
	}
	var original, roundTrip any
	if err := json.Unmarshal(raw, &original); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(encoded, &roundTrip); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(roundTrip, original) {
		t.Fatalf("Go PromptText ABI does not round-trip the shared golden fixture: %s", encoded)
	}
	if fixture.Request.Method != PromptTextMethod ||
		fixture.Request.Query.ProtocolVersion != PromptTextProtocolVersion {
		t.Fatalf("request identity = %#v, want PromptText v1", fixture.Request)
	}
	response := fixture.Response.Response
	if !fixture.Response.OK || response.Status.Kind != PromptTextStatusComplete ||
		len(response.Templates) != 1 {
		t.Fatalf("response = %#v, want one complete template", fixture.Response)
	}
	heading, ok := response.Templates[0].Blocks[0].Heading()
	if !ok || heading.Label != "Hello" || heading.Range == heading.TextRange {
		t.Fatalf("heading = %#v, %v; want distinct construct and text ranges", heading, ok)
	}
}

func promptTextGoldenFixturePath(t *testing.T) string {
	t.Helper()
	_, current, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve PromptText golden fixture caller")
	}
	return filepath.Clean(filepath.Join(
		filepath.Dir(current),
		"../../../../../indexer/src/contracts/fixtures/prompt-text-query-v1.json",
	))
}
