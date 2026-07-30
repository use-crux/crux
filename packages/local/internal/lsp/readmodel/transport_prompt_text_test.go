package readmodel

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	indexprompttext "github.com/use-crux/crux/packages/local/internal/projectindex/prompttext"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestAttachTransportPromptTextClassifiesMissingRouteAsUnavailable(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()

	_, err := NewAttachTransport(api.New(server.URL)).PromptText(
		context.Background(),
		PromptTextRequest{File: "writer.ts", LanguageID: "typescript"},
	)
	if !errors.Is(err, ErrPromptTextUnavailable) {
		t.Fatalf("missing route error = %v, want ErrPromptTextUnavailable", err)
	}
}

func TestAttachTransportPromptTextPreservesExactRevision(t *testing.T) {
	revision := staticprotocol.PromptTextDocumentRevision{
		OpenEpoch: 7, Version: 14, SourceHash: "exact-hash",
	}
	want := indexprompttext.Request{
		File: "/repo/src/writer.ts", LanguageID: "typescript",
		Revision: revision, Text: "export const writer = md`# Hello`",
	}
	wantResult := indexprompttext.Result{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            want.File,
		Revision:        revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{},
		Refactors: staticprotocol.PromptTextRefactorAnalysis{
			Status: staticprotocol.PromptTextAnalysisStatus{
				Kind: staticprotocol.PromptTextStatusComplete,
			},
			Proofs: []staticprotocol.PromptTextRefactorProof{},
		},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/project/index/prompt-text" {
			http.NotFound(w, r)
			return
		}
		var got indexprompttext.Request
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil || !reflect.DeepEqual(got, want) {
			t.Errorf("request = %+v, err = %v, want %+v", got, err, want)
		}
		_ = json.NewEncoder(w).Encode(wantResult)
	}))
	defer server.Close()

	result, err := NewAttachTransport(api.New(server.URL)).PromptText(
		context.Background(),
		PromptTextRequest(want),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(result, PromptTextResult(wantResult)) {
		t.Fatalf("result = %+v, want %+v", result, wantResult)
	}
}

func TestAttachTransportPromptTextRejectsUnknownResponseFields(t *testing.T) {
	t.Parallel()

	request := PromptTextRequest{
		File: "/repo/writer.ts",
		Revision: staticprotocol.PromptTextDocumentRevision{
			OpenEpoch: 1, Version: 2, SourceHash: "hash",
		},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{
			"protocolVersion":1,
			"file":"/repo/writer.ts",
			"revision":{"openEpoch":1,"version":2,"sourceHash":"hash"},
			"status":{"kind":"complete"},
			"templates":[],
			"futureField":true
		}`))
	}))
	defer server.Close()

	_, err := NewAttachTransport(api.New(server.URL)).PromptText(context.Background(), request)
	if err == nil || !strings.Contains(err.Error(), "futureField") {
		t.Fatalf("PromptText error = %v, want unknown-field rejection", err)
	}
}

func TestAttachTransportPromptTextRejectsMismatchedResponseIdentity(t *testing.T) {
	t.Parallel()

	request := PromptTextRequest{
		File: "/repo/writer.ts",
		Revision: staticprotocol.PromptTextDocumentRevision{
			OpenEpoch: 1, Version: 2, SourceHash: "hash",
		},
	}
	for name, mutate := range map[string]func(*indexprompttext.Result){
		"protocol": func(result *indexprompttext.Result) { result.ProtocolVersion++ },
		"file":     func(result *indexprompttext.Result) { result.File = "/repo/other.ts" },
		"revision": func(result *indexprompttext.Result) { result.Revision.Version++ },
	} {
		t.Run(name, func(t *testing.T) {
			result := indexprompttext.Result{
				ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
				File:            request.File,
				Revision:        request.Revision,
				Status: staticprotocol.PromptTextAnalysisStatus{
					Kind: staticprotocol.PromptTextStatusComplete,
				},
				Templates: []staticprotocol.PromptTextTemplate{},
				Refactors: staticprotocol.PromptTextRefactorAnalysis{
					Status: staticprotocol.PromptTextAnalysisStatus{
						Kind: staticprotocol.PromptTextStatusComplete,
					},
					Proofs: []staticprotocol.PromptTextRefactorProof{},
				},
			}
			mutate(&result)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(result)
			}))
			defer server.Close()

			if _, err := NewAttachTransport(api.New(server.URL)).PromptText(
				context.Background(), request,
			); err == nil {
				t.Fatal("mismatched PromptText response identity was accepted")
			}
		})
	}
}
