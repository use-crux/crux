package localserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	indexcompletion "github.com/use-crux/crux/packages/local/internal/projectindex/completion"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestCompletionRouteMatchesDirectProviderResultBytes(t *testing.T) {
	provider := completionRouteProvider{result: indexcompletion.Result{
		DocumentVersion: 17,
		Generation:      9,
		Items: []staticprotocol.CompletionItem{{
			ID: "prompt:writer", Kind: "prompt", Label: "writer", Detail: "prompt · prompt:writer",
			InsertText: "writer", Replacement: staticprotocol.CompletionRange{
				Start: staticprotocol.CompletionPosition{Line: 2, Character: 32},
				End:   staticprotocol.CompletionPosition{Line: 2, Character: 34},
			},
		}},
	}}
	request := indexcompletion.Request{
		File: "/repo/src/agent.ts", DocumentVersion: 17, LanguageID: "typescript",
		Text: "const support = agent({ prompt: wr", Position: staticprotocol.CompletionPosition{Line: 0, Character: 34}, Limit: 100,
	}
	direct, err := provider.Complete(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := json.Marshal(direct)
	body, _ := json.Marshal(request)
	response := httptest.NewRecorder()
	New(Options{Completion: provider}).ServeHTTP(
		response,
		httptest.NewRequest(http.MethodPost, "/api/project/index/completions", bytes.NewReader(body)),
	)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %q", response.Code, response.Body.String())
	}
	if got := bytes.TrimSpace(response.Body.Bytes()); !bytes.Equal(got, want) {
		t.Fatalf("HTTP result = %s, direct = %s", got, want)
	}
}

func TestCompletionRouteRejectsInvalidAndOversizedRequestsWithoutEchoingSource(t *testing.T) {
	secret := "private-unsaved-secret"
	tests := []struct {
		name   string
		body   []byte
		status int
	}{
		{name: "unknown field", body: []byte(`{"file":"a.ts","unknown":"private-unsaved-secret"}`), status: http.StatusBadRequest},
		{name: "oversized", body: bytes.Repeat([]byte("x"), indexcompletion.MaxRequestBytes+1), status: http.StatusRequestEntityTooLarge},
	}
	documentBody, _ := json.Marshal(indexcompletion.Request{
		File: "a.ts", LanguageID: "typescript", Text: strings.Repeat("x", indexcompletion.MaxDocumentBytes+1),
	})
	tests = append(tests, struct {
		name   string
		body   []byte
		status int
	}{name: "oversized document", body: documentBody, status: http.StatusRequestEntityTooLarge})
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			New(Options{Completion: completionRouteProvider{}}).ServeHTTP(
				response,
				httptest.NewRequest(http.MethodPost, "/api/project/index/completions", bytes.NewReader(test.body)),
			)
			if response.Code != test.status || strings.Contains(response.Body.String(), secret) {
				t.Fatalf("response = %d %q", response.Code, response.Body.String())
			}
		})
	}
}

func TestCompletionRoutePropagatesRequestCancellation(t *testing.T) {
	provider := &cancellingCompletionRouteProvider{started: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/project/index/completions",
		strings.NewReader(`{"file":"a.ts","languageId":"typescript"}`),
	).WithContext(ctx)
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		New(Options{Completion: provider}).ServeHTTP(response, request)
		close(done)
	}()
	<-provider.started
	cancel()
	<-done
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("cancelled response = %d %q, want 503", response.Code, response.Body.String())
	}
}

func TestCompletionRouteNeverLogsOrReflectsUnsavedSource(t *testing.T) {
	const secret = "private-unsaved-completion-secret"
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	body, _ := json.Marshal(indexcompletion.Request{
		File: "a.ts", LanguageID: "typescript", Text: secret,
	})
	response := httptest.NewRecorder()
	New(Options{
		Logger: logger, Completion: completionRouteProvider{err: errors.New("compiler rejected " + secret)},
	}).ServeHTTP(response, httptest.NewRequest(
		http.MethodPost, "/api/project/index/completions", bytes.NewReader(body),
	))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("response = %d %q, want 503", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), secret) || strings.Contains(logs.String(), secret) {
		t.Fatalf("unsaved source leaked: response=%q logs=%q", response.Body.String(), logs.String())
	}
}

func TestCompletionRouteFailsSoftWhenProviderIsUnavailable(t *testing.T) {
	response := httptest.NewRecorder()
	New(Options{Completion: completionRouteProvider{err: errors.New("private source failure")}}).ServeHTTP(
		response,
		httptest.NewRequest(http.MethodPost, "/api/project/index/completions", strings.NewReader(`{"file":"a.ts","languageId":"typescript"}`)),
	)
	if response.Code != http.StatusServiceUnavailable || strings.Contains(response.Body.String(), "private source failure") {
		t.Fatalf("response = %d %q", response.Code, response.Body.String())
	}
}

type completionRouteProvider struct {
	result indexcompletion.Result
	err    error
}

func (p completionRouteProvider) Complete(_ context.Context, _ indexcompletion.Request) (indexcompletion.Result, error) {
	return p.result, p.err
}

type cancellingCompletionRouteProvider struct {
	started chan struct{}
}

func (p *cancellingCompletionRouteProvider) Complete(ctx context.Context, _ indexcompletion.Request) (indexcompletion.Result, error) {
	close(p.started)
	<-ctx.Done()
	return indexcompletion.Result{}, ctx.Err()
}
