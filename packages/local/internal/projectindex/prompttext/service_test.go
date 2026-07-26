package prompttext

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"

	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestServiceAnalyzesTheSharedCanonicalHeading(t *testing.T) {
	t.Parallel()

	golden := readPromptTextGolden(t)
	compiler := &recordingCompiler{response: golden.Response.Response}
	service := New(compiler)

	result, err := service.Analyze(context.Background(), Request{
		File:       golden.Request.Query.File,
		LanguageID: golden.Request.Query.LanguageID,
		Revision:   golden.Request.Query.Revision,
		Text:       golden.Request.Query.Source,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(compiler.query, golden.Request.Query) {
		t.Fatalf("compiler query = %#v, want shared golden %#v", compiler.query, golden.Request.Query)
	}
	if !reflect.DeepEqual(result, golden.Response.Response) {
		t.Fatalf("result = %#v, want shared golden %#v", result, golden.Response.Response)
	}
}

type promptTextGolden struct {
	Request  staticprotocol.PromptTextWorkerRequest                                `json:"request"`
	Response staticprotocol.WorkerResponse[staticprotocol.PromptTextQueryResponse] `json:"response"`
}

func readPromptTextGolden(t *testing.T) promptTextGolden {
	t.Helper()
	_, current, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve PromptText golden fixture caller")
	}
	path := filepath.Clean(filepath.Join(
		filepath.Dir(current),
		"../../../../indexer/src/contracts/fixtures/prompt-text-query-v1.json",
	))
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture promptTextGolden
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

type recordingCompiler struct {
	query    CompilerQuery
	response CompilerResponse
}

func (c *recordingCompiler) PromptText(
	_ context.Context,
	query CompilerQuery,
) (CompilerResponse, error) {
	c.query = query
	return c.response, nil
}
