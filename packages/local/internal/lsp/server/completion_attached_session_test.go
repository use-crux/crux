package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	indexcompletion "github.com/use-crux/crux/packages/local/internal/projectindex/completion"
	localruntime "github.com/use-crux/crux/packages/local/internal/server"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestAttachedCompletionAndLateHandoverMatchGolden(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "src", "agent.ts")
	state := store.NewStore()
	state.SetIndexData(store.IndexData{Definitions: []store.ProjectDefinition{{
		ID: "prompt:writer", Kind: "prompt", Name: "writer",
		Source:   &store.SourceLoc{File: "src/writer.ts", Line: 1},
		Metadata: json.RawMessage(`{"exportName":"writer"}`),
	}}})
	compiler := &attachedTranscriptIndexer{secondStarted: make(chan struct{}), releaseSecond: make(chan struct{})}
	devtoolsService := devtools.NewService(state, nil).WithProjectIndexer(compiler)
	defer devtoolsService.Shutdown()
	httpServer := httptest.NewServer(localruntime.NewHTTPServerWithServices(devtoolsService, localruntime.ServerOptions{
		ProjectRoot: root, ServerVersion: "v-test",
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}))
	defer httpServer.Close()

	transport := readmodel.NewAttachTransport(api.New(httpServer.URL))
	snapshot, err := transport.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	indexStore := readmodel.NewStore()
	indexStore.ApplySnapshot("scope", snapshot)
	session := &scopeSession{
		scope: readmodel.Scope{ID: "scope", Root: root}, mode: readmodel.ModeAttached,
		completion: transport, sourceEpoch: 1,
	}
	workspace := &workspaceRuntime{store: indexStore, sessions: []*scopeSession{session}}
	editor := newTrustedCompletionServer(Options{Version: "v-test"})
	editor.workspace = workspace
	uri := protocol.DocumentURI("file://" + filepath.ToSlash(file))
	const privateSource = "agent({ prompt: privateUnsavedCompletionSecret"
	editor.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 21, Text: privateSource,
	})

	first := attachedCompletionRequest(editor, uri, 1).Deferred().Result.(protocol.CompletionList)
	afterCompletion, err := transport.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	afterJSON, _ := json.Marshal(afterCompletion)
	if bytes.Contains(afterJSON, []byte("privateUnsavedCompletionSecret")) {
		t.Fatal("unsaved completion source entered the Project Index snapshot")
	}
	secondResult := attachedCompletionRequest(editor, uri, 2)
	secondDone := make(chan protocol.CompletionList, 1)
	go func() { secondDone <- secondResult.Deferred().Result.(protocol.CompletionList) }()
	<-compiler.secondStarted
	workspace.setSessionCompletionSource(session, nil)
	workspace.setSessionMode(session, readmodel.ModeOwn)
	close(compiler.releaseSecond)
	second := <-secondDone

	var transcript bytes.Buffer
	for _, list := range []protocol.CompletionList{first, second} {
		encoded, err := json.Marshal(list)
		if err != nil {
			t.Fatal(err)
		}
		transcript.Write(encoded)
		transcript.WriteByte('\n')
	}
	want, err := os.ReadFile(filepath.Join("testdata", "completion-attached.output"))
	if err != nil {
		t.Fatalf("read attached completion golden: %v\n--- got ---\n%s", err, transcript.String())
	}
	if transcript.String() != string(want) {
		t.Fatalf("attached completion transcript mismatch\n--- got ---\n%s--- want ---\n%s", transcript.String(), want)
	}
}

func attachedCompletionRequest(editor *Server, uri protocol.DocumentURI, id int) jsonrpc.HandlerResult {
	requestID, _ := json.Marshal(id)
	return editor.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: requestID, Method: protocol.MethodCompletion,
		Params: []byte(`{"textDocument":{"uri":"` + string(uri) + `"},"position":{"line":0,"character":18}}`),
	})
}

type attachedTranscriptIndexer struct {
	mu            sync.Mutex
	calls         int
	secondStarted chan struct{}
	releaseSecond chan struct{}
}

func (*attachedTranscriptIndexer) IndexProjectAstPatch(context.Context, string, string, string) (projectindex.IndexPatch, error) {
	return projectindex.IndexPatch{}, nil
}

func (i *attachedTranscriptIndexer) Completion(_ context.Context, _ indexcompletion.CompilerQuery) (indexcompletion.CompilerResponse, error) {
	i.mu.Lock()
	i.calls++
	call := i.calls
	i.mu.Unlock()
	if call == 2 {
		close(i.secondStarted)
		<-i.releaseSecond
	}
	return indexcompletion.CompilerResponse{Items: []indexcompletion.Item{{
		ID: "prompt:writer", Kind: "prompt", Label: "writer", Detail: "prompt · prompt:writer", InsertText: "writer",
		Replacement: indexcompletion.Range{
			Start: indexcompletion.Position{Character: 16}, End: indexcompletion.Position{Character: 18},
		},
	}}}, nil
}
