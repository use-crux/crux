package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	indexcompletion "github.com/use-crux/crux/packages/local/internal/projectindex/completion"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestHTTPCompletionMatchesDirectHubBytes(t *testing.T) {
	state := store.NewStore()
	state.SetIndexData(store.IndexData{Definitions: []store.ProjectDefinition{
		completionStoreDefinition("prompt:writer", "writer"),
	}})
	compiler := &echoHubCompletionIndexer{}
	service := devtools.NewService(state, nil).WithProjectIndexer(compiler)
	defer service.Shutdown()
	var hub *WSHub
	handler := NewHTTPServerWithServices(service, ServerOptions{
		ProjectRoot: "/repo", ServerVersion: "0.9.0-test",
		webSocketHubCreated: func(created *WSHub) { hub = created },
	})
	request := indexcompletion.Request{
		File: "/repo/src/agent.ts", DocumentVersion: 12, LanguageID: "typescript",
		Text: "agent({ prompt: wr", Position: indexcompletion.Position{Character: 18}, Limit: 100,
	}
	direct, err := hub.Complete(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := json.Marshal(direct)
	body, _ := json.Marshal(request)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/project/index/completions", bytes.NewReader(body)))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	if got := bytes.TrimSpace(response.Body.Bytes()); !bytes.Equal(got, want) {
		t.Fatalf("HTTP result = %s, direct = %s", got, want)
	}
}

func TestHubCompletionPinsCoherentViewWithoutHoldingIndexLockDuringCompilerCall(t *testing.T) {
	state := store.NewStore()
	state.SetIndexData(store.IndexData{Definitions: []store.ProjectDefinition{
		completionStoreDefinition("prompt:first", "first"),
	}})
	compiler := &blockingHubCompletionIndexer{started: make(chan struct{}), release: make(chan struct{})}
	service := devtools.NewService(state, nil).WithProjectIndexer(compiler)
	hub := &WSHub{devtools: service, projectRoot: "/repo", serverVersion: "0.9.0-test"}

	type outcome struct {
		result indexcompletion.Result
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		result, err := hub.Complete(context.Background(), indexcompletion.Request{
			File: "/repo/src/agent.ts", DocumentVersion: 12, LanguageID: "typescript",
		})
		done <- outcome{result: result, err: err}
	}()
	<-compiler.started

	updated := make(chan struct{})
	go func() {
		hub.indexUpdateMessages(store.IndexData{Definitions: []store.ProjectDefinition{
			completionStoreDefinition("prompt:second", "second"),
		}})
		close(updated)
	}()
	select {
	case <-updated:
	case <-time.After(time.Second):
		t.Fatal("index update blocked behind transient compiler query")
	}
	close(compiler.release)
	completed := <-done
	if completed.err != nil {
		t.Fatal(completed.err)
	}
	if completed.result.DocumentVersion != 12 || completed.result.Generation != 0 {
		t.Fatalf("completion identity = %+v, want V12/G0", completed.result)
	}
	if len(compiler.query.Candidates) != 1 || compiler.query.Candidates[0].ID != "prompt:first" {
		t.Fatalf("compiler candidates = %+v, want pre-update coherent view", compiler.query.Candidates)
	}
	latest, err := hub.ProjectIndex(context.Background())
	if err != nil || latest.Generation != 1 || latest.Definitions[0].ID != "prompt:second" {
		t.Fatalf("latest snapshot = %+v, err = %v, want second at G1", latest, err)
	}
}

func completionStoreDefinition(id, binding string) store.ProjectDefinition {
	return store.ProjectDefinition{
		ID: id, Kind: "prompt", Name: binding,
		Source:   &store.SourceLoc{File: "src/" + binding + ".ts", Line: 1},
		Metadata: json.RawMessage(`{"exportName":"` + binding + `","exported":true}`),
	}
}

type blockingHubCompletionIndexer struct {
	started chan struct{}
	release chan struct{}
	query   indexcompletion.CompilerQuery
}

type echoHubCompletionIndexer struct{}

func (*echoHubCompletionIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, nil
}

func (*echoHubCompletionIndexer) Completion(_ context.Context, query indexcompletion.CompilerQuery) (indexcompletion.CompilerResponse, error) {
	if len(query.Candidates) != 1 {
		return indexcompletion.CompilerResponse{}, fmt.Errorf(
			"compiler candidates = %d, want 1",
			len(query.Candidates),
		)
	}
	return indexcompletion.CompilerResponse{Items: []indexcompletion.Item{{
		ID: query.Candidates[0].ID, Kind: query.Candidates[0].Kind,
		Label: query.Candidates[0].Binding, InsertText: query.Candidates[0].Binding,
	}}}, nil
}

func (*blockingHubCompletionIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, nil
}

func (i *blockingHubCompletionIndexer) Completion(_ context.Context, query indexcompletion.CompilerQuery) (indexcompletion.CompilerResponse, error) {
	i.query = query
	close(i.started)
	<-i.release
	return indexcompletion.CompilerResponse{}, nil
}
