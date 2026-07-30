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
		len(response.Templates) != 3 {
		t.Fatalf("response = %#v, want two complete and one unsupported template", fixture.Response)
	}
	if response.Refactors.Status.Kind != PromptTextStatusComplete ||
		len(response.Refactors.Proofs) != 1 ||
		response.Templates[0].BacktickRanges[0].Start.Character != 12 ||
		response.Templates[0].BacktickRanges[1].Start.Character != 20 {
		t.Fatalf("backticks/refactors = %#v / %#v, want exact complete V1 fields",
			response.Templates[0].BacktickRanges, response.Refactors)
	}
	refactor := response.Refactors.Proofs[0]
	if refactor.Kind != "ordinary-string-to-md" ||
		refactor.CandidateID != 0 ||
		refactor.ExpectedText != "\"first\\nsecond\"" ||
		refactor.TemplateText != "`\nfirst\nsecond\n`" ||
		refactor.Proof != PromptTextRefactorProofSyntaxExact {
		t.Fatalf("refactor = %#v, want shared nonempty V1 proof", refactor)
	}
	heading, ok := response.Templates[0].Blocks[0].Heading()
	if !ok || heading.Label != "Hello" || heading.Range == heading.TextRange {
		t.Fatalf("heading = %#v, %v; want distinct construct and text ranges", heading, ok)
	}
	proof := response.Templates[1].InterpolationBarriers[0].LineIsolationEdit
	if proof == nil ||
		proof.ExpectedText != " ${items} " ||
		proof.NewText != "\n${items}\n" {
		t.Fatalf("line-isolation proof = %#v, want shared V1 fixture", proof)
	}
	unsupported := response.Templates[2]
	if unsupported.Status.Kind != PromptTextStatusUnsupported ||
		unsupported.BacktickRanges[0].Start.Character != 18 ||
		unsupported.BacktickRanges[1].Start.Character != 29 ||
		len(unsupported.LiteralIslands) != 0 ||
		len(unsupported.InterpolationBarriers) != 0 ||
		len(unsupported.Mappings) != 0 ||
		len(unsupported.Blocks) != 0 ||
		len(unsupported.Spans) != 0 ||
		len(unsupported.Links) != 0 ||
		len(unsupported.Nesting) != 0 ||
		unsupported.Preview.Text != "" ||
		len(unsupported.Preview.Segments) != 0 {
		t.Fatalf("unsupported template = %#v, want empty payload and exact backticks", unsupported)
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
