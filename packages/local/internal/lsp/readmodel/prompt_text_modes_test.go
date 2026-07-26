package readmodel

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	indexprompttext "github.com/use-crux/crux/packages/local/internal/projectindex/prompttext"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestPromptTextOwnAndAttachedMatchSharedHeadingFixture(t *testing.T) {
	t.Parallel()

	golden := readPromptTextModeGolden(t)
	compiler := &fixedPromptTextCompiler{
		response: golden.Response.Response,
	}
	request := indexprompttext.Request{
		File: golden.Request.Query.File, LanguageID: golden.Request.Query.LanguageID,
		Revision: golden.Request.Query.Revision, Text: golden.Request.Query.Source,
	}
	own := &ownIndexerSource{promptTextCompiler: compiler}
	ownResult, err := own.PromptText(context.Background(), request)
	if err != nil {
		t.Fatalf("OWN PromptText: %v", err)
	}

	service := indexprompttext.New(compiler)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/project/index/prompt-text" {
			http.NotFound(w, r)
			return
		}
		var attachedRequest indexprompttext.Request
		if err := json.NewDecoder(r.Body).Decode(&attachedRequest); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		result, err := service.Analyze(r.Context(), attachedRequest)
		if err != nil {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		_ = json.NewEncoder(w).Encode(result)
	}))
	defer server.Close()
	attachedResult, err := NewAttachTransport(api.New(server.URL)).
		PromptText(context.Background(), request)
	if err != nil {
		t.Fatalf("ATTACHED PromptText: %v", err)
	}

	if !reflect.DeepEqual(ownResult, attachedResult) ||
		!reflect.DeepEqual(ownResult, golden.Response.Response) {
		t.Fatalf(
			"mode results diverged\nOWN: %#v\nATTACHED: %#v\nGOLDEN: %#v",
			ownResult,
			attachedResult,
			golden.Response.Response,
		)
	}
}

type promptTextModeGolden struct {
	Request  staticprotocol.PromptTextWorkerRequest                                `json:"request"`
	Response staticprotocol.WorkerResponse[staticprotocol.PromptTextQueryResponse] `json:"response"`
}

func readPromptTextModeGolden(t *testing.T) promptTextModeGolden {
	t.Helper()

	_, caller, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve PromptText mode fixture caller")
	}
	data, err := os.ReadFile(filepath.Join(
		filepath.Dir(caller),
		"../../../../indexer/src/contracts/fixtures/prompt-text-query-v1.json",
	))
	if err != nil {
		t.Fatal(err)
	}
	var fixture promptTextModeGolden
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

type fixedPromptTextCompiler struct {
	response staticprotocol.PromptTextQueryResponse
}

func (c *fixedPromptTextCompiler) PromptText(
	context.Context,
	staticprotocol.PromptTextQuery,
) (staticprotocol.PromptTextQueryResponse, error) {
	return c.response, nil
}
