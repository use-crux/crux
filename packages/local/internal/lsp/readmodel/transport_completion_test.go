package readmodel

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	indexcompletion "github.com/use-crux/crux/packages/local/internal/projectindex/completion"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestAttachTransportCompletionClassifiesMissingRouteAsUnavailable(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	_, err := NewAttachTransport(api.New(server.URL)).Completion(
		context.Background(),
		CompletionRequest{File: "agent.ts", LanguageID: "typescript"},
	)
	if !errors.Is(err, ErrCompletionUnavailable) {
		t.Fatalf("missing route error = %v, want ErrCompletionUnavailable", err)
	}
}

func TestAttachTransportCompletionPreservesRequestAndResponseIdentity(t *testing.T) {
	want := indexcompletion.Request{
		File: "/repo/src/agent.ts", DocumentVersion: 14, LanguageID: "typescript",
		Text: "agent({ prompt: wr", Position: staticprotocol.CompletionPosition{Character: 18}, Limit: 100,
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/project/index/completions" {
			http.NotFound(w, r)
			return
		}
		var got indexcompletion.Request
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil || got != want {
			t.Errorf("request = %+v, err = %v, want %+v", got, err, want)
		}
		_ = json.NewEncoder(w).Encode(indexcompletion.Result{
			DocumentVersion: 14, Generation: 6,
			Items: []staticprotocol.CompletionItem{{ID: "prompt:writer", Label: "writer"}},
		})
	}))
	defer server.Close()

	result, err := NewAttachTransport(api.New(server.URL)).Completion(context.Background(), CompletionRequest{
		File: want.File, DocumentVersion: want.DocumentVersion, LanguageID: want.LanguageID,
		Text: want.Text, Position: want.Position, Limit: want.Limit,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.DocumentVersion != 14 || result.Generation != 6 || len(result.Items) != 1 {
		t.Fatalf("result = %+v, want V14/G6 and one item", result)
	}
}

func TestAttachTransportCompletionPropagatesCancellation(t *testing.T) {
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		close(started)
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := NewAttachTransport(api.New(server.URL)).Completion(ctx, CompletionRequest{
			File: "agent.ts", LanguageID: "typescript",
		})
		done <- err
	}()
	<-started
	cancel()
	if err := <-done; err == nil {
		t.Fatal("cancelled completion returned nil error")
	}
}
