package server

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestBinaryOwnCompletionCoversFirstPartyReferenceShapes(t *testing.T) {
	binary := os.Getenv("CRUX_LSP_E2E_BINARY")
	worker := os.Getenv("CRUX_STATIC_INDEX_WORKER")
	if binary == "" || worker == "" {
		t.Skip("set CRUX_LSP_E2E_BINARY and CRUX_STATIC_INDEX_WORKER to built binaries")
	}
	root := copyFixtureProject(t)
	file := filepath.Join(root, "src", "completion.ts")
	reviewerFile := filepath.Join(root, "src", "reviewer.ts")
	reviewerText := "import { agent } from '@use-crux/core/agent'\n" +
		"export const reviewer = agent({ id: 'reviewer' })\n"
	if err := os.WriteFile(reviewerFile, []byte(reviewerText), 0o600); err != nil {
		t.Fatal(err)
	}
	diskText := "import { context, prompt, tool } from '@use-crux/core'\n" +
		"import { agent } from '@use-crux/core/agent'\n" +
		"import { router } from '@use-crux/core/routing'\n" +
		"export const brandContext = context({ id: 'brand' })\n" +
		"export const searchTool = tool({ name: 'search' })\n" +
		"export const writer = prompt({ id: 'writer' })\n" +
		"export const qualityRouter = router({ id: 'quality', routes: { default: writer } })\n" +
		"export const draft = prompt({ id: 'draft', use: [brandContext], tools: { search: searchTool } })\n" +
		"export const support = agent({ id: 'support', prompt: writer, model: qualityRouter })\n" +
		"export const triage = agent({ id: 'triage', handoffs: ['reviewer'] })\n"
	if err := os.WriteFile(file, []byte(diskText), 0o600); err != nil {
		t.Fatal(err)
	}
	dirtyText := "import { context, prompt, tool } from '@use-crux/core'\n" +
		"import { agent } from '@use-crux/core/agent'\n" +
		"import { router } from '@use-crux/core/routing'\n" +
		"export const brandContext = context({ id: 'brand' })\n" +
		"export const searchTool = tool({ name: 'search' })\n" +
		"export const writer = prompt({ id: 'writer' })\n" +
		"export const qualityRouter = router({ id: 'quality', routes: { default: writer } })\n" +
		"export const draft = prompt({ id: 'draft', use: [bra], tools: { sea } })\n" +
		"export const support = agent({ id: 'support', prompt: wri, model: qua })\n" +
		"export const triage = agent({ id: 'triage', handoffs: ['rev'] })\n"

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "lsp", "--port", "4596", "--root", root)
	command.Dir = root
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if command.ProcessState == nil {
			_ = command.Process.Kill()
		}
	})

	writerRPC := jsonrpc.NewWriter(stdin)
	reader := jsonrpc.NewReader(stdout)
	rootURI := protocol.DocumentURI("file://" + filepath.ToSlash(root))
	writeLSP(t, writerRPC, map[string]any{
		"jsonrpc": "2.0", "id": 1, "method": protocol.MethodInitialize,
		"params": map[string]any{
			"rootUri": rootURI, "initializationOptions": map[string]any{"workspaceTrust": true},
		},
	})
	readUntil(t, reader, func(message map[string]json.RawMessage) bool { return string(message["id"]) == "1" })
	writeLSP(t, writerRPC, map[string]any{"jsonrpc": "2.0", "method": protocol.MethodInitialized})
	uri := protocol.DocumentURI("file://" + filepath.ToSlash(file))
	writeLSP(t, writerRPC, map[string]any{
		"jsonrpc": "2.0", "method": protocol.MethodDidOpen,
		"params": protocol.DidOpenTextDocumentParams{TextDocument: protocol.TextDocumentItem{
			URI: uri, LanguageID: "typescript", Version: 17, Text: dirtyText,
		}},
	})

	cases := []struct {
		needle, label, insert string
	}{
		{"use: [bra", "brandContext", "brandContext"},
		{"tools: { sea", "searchTool", "search: searchTool"},
		{"prompt: wri", "writer", "writer"},
		{"model: qua", "qualityRouter", "qualityRouter"},
		{"handoffs: ['rev", "reviewer", "reviewer"},
	}
	var first protocol.CompletionItem
	for index, test := range cases {
		item := waitForE2ECompletionItem(
			t, writerRPC, reader, uri,
			completionPositionAfter(t, dirtyText, test.needle),
			test.label, 100+index*100,
		)
		if item.TextEdit == nil || item.TextEdit.NewText != test.insert {
			t.Fatalf("%s completion = %+v, want insert %q", test.needle, item, test.insert)
		}
		if test.label == "reviewer" && len(item.AdditionalTextEdits) != 0 {
			t.Fatalf("handoff completion = %+v, want no import edits", item)
		}
		if index == 0 {
			first = item
		}
	}
	var data completionItemData
	if json.Unmarshal(first.Data, &data) != nil || data.DocumentVersion != 17 || data.IndexGeneration == 0 {
		t.Fatalf("completion data = %s, want V17 and nonzero OWN generation", first.Data)
	}
	if bytes.Contains(stderr.Bytes(), []byte("use: [bra")) {
		t.Fatal("unsaved completion source leaked to process logs")
	}

	writeLSP(t, writerRPC, map[string]any{"jsonrpc": "2.0", "id": 999, "method": protocol.MethodShutdown})
	readUntil(t, reader, func(message map[string]json.RawMessage) bool { return string(message["id"]) == "999" })
	writeLSP(t, writerRPC, map[string]any{"jsonrpc": "2.0", "method": protocol.MethodExit})
	_ = stdin.Close()
	if err := command.Wait(); err != nil {
		t.Fatalf("crux lsp: %v\n%s", err, stderr.String())
	}
}

func TestBinaryOwnCompletionAddsSafeCrossFileImport(t *testing.T) {
	binary := os.Getenv("CRUX_LSP_E2E_BINARY")
	worker := os.Getenv("CRUX_STATIC_INDEX_WORKER")
	if binary == "" || worker == "" {
		t.Skip("set CRUX_LSP_E2E_BINARY and CRUX_STATIC_INDEX_WORKER to built binaries")
	}
	root := copyFixtureProject(t)
	promptFile := filepath.Join(root, "src", "prompts.ts")
	if err := os.WriteFile(promptFile, []byte(
		"import { prompt } from '@use-crux/core'\nexport const phaseSevenWriter = prompt({ id: 'phase-seven-writer' })\n",
	), 0o600); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "src", "completion.ts")
	diskText := "import { agent } from '@use-crux/core/agent'\n" +
		"import { phaseSevenWriter } from './prompts'\n" +
		"export const support = agent({ id: 'support', prompt: phaseSevenWriter })\n"
	if err := os.WriteFile(file, []byte(diskText), 0o600); err != nil {
		t.Fatal(err)
	}
	dirtyText := "import { agent } from '@use-crux/core/agent'\n\n" +
		"export const support = agent({ id: 'support', prompt: phaseSev"

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "lsp", "--port", "4597", "--root", root)
	command.Dir = root
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if command.ProcessState == nil {
			_ = command.Process.Kill()
		}
	})

	writerRPC := jsonrpc.NewWriter(stdin)
	reader := jsonrpc.NewReader(stdout)
	rootURI := protocol.DocumentURI("file://" + filepath.ToSlash(root))
	writeLSP(t, writerRPC, map[string]any{
		"jsonrpc": "2.0", "id": 1, "method": protocol.MethodInitialize,
		"params": map[string]any{
			"rootUri": rootURI, "initializationOptions": map[string]any{"workspaceTrust": true},
		},
	})
	readUntil(t, reader, func(message map[string]json.RawMessage) bool { return string(message["id"]) == "1" })
	writeLSP(t, writerRPC, map[string]any{"jsonrpc": "2.0", "method": protocol.MethodInitialized})
	uri := protocol.DocumentURI("file://" + filepath.ToSlash(file))
	writeLSP(t, writerRPC, map[string]any{
		"jsonrpc": "2.0", "method": protocol.MethodDidOpen,
		"params": protocol.DidOpenTextDocumentParams{TextDocument: protocol.TextDocumentItem{
			URI: uri, LanguageID: "typescript", Version: 23, Text: dirtyText,
		}},
	})

	var item protocol.CompletionItem
	for attempt := 0; attempt < 80 && item.Label == ""; attempt++ {
		id := 300 + attempt
		writeLSP(t, writerRPC, map[string]any{
			"jsonrpc": "2.0", "id": id, "method": protocol.MethodCompletion,
			"params": protocol.CompletionParams{
				TextDocument: protocol.TextDocumentIdentifier{URI: uri},
				Position:     protocol.Position{Line: 2, Character: 62},
			},
		})
		response := readUntil(t, reader, func(message map[string]json.RawMessage) bool {
			return string(message["id"]) == jsonNumber(id)
		})
		var list protocol.CompletionList
		if json.Unmarshal(response["result"], &list) == nil {
			for _, candidate := range list.Items {
				if candidate.Label == "phaseSevenWriter" {
					item = candidate
				}
			}
		}
		if item.Label == "" {
			time.Sleep(100 * time.Millisecond)
		}
	}
	if item.TextEdit == nil || len(item.AdditionalTextEdits) != 1 {
		t.Fatalf("cross-file completion = %+v, want main edit plus one import\nstderr:\n%s", item, stderr.String())
	}
	got := applyCompletionItem(t, dirtyText, item)
	want := "import { agent } from '@use-crux/core/agent'\n" +
		"import { phaseSevenWriter } from './prompts'\n\n" +
		"export const support = agent({ id: 'support', prompt: phaseSevenWriter"
	if got != want {
		t.Fatalf("applied completion source:\n%s\nwant:\n%s", got, want)
	}

	writeLSP(t, writerRPC, map[string]any{"jsonrpc": "2.0", "id": 999, "method": protocol.MethodShutdown})
	readUntil(t, reader, func(message map[string]json.RawMessage) bool { return string(message["id"]) == "999" })
	writeLSP(t, writerRPC, map[string]any{"jsonrpc": "2.0", "method": protocol.MethodExit})
	_ = stdin.Close()
	if err := command.Wait(); err != nil {
		t.Fatalf("crux lsp: %v\n%s", err, stderr.String())
	}
}

func applyCompletionItem(t *testing.T, source string, item protocol.CompletionItem) string {
	t.Helper()
	edits := append([]protocol.TextEdit(nil), item.AdditionalTextEdits...)
	edits = append(edits, *item.TextEdit)
	sort.Slice(edits, func(left, right int) bool {
		if edits[left].Range.Start.Line != edits[right].Range.Start.Line {
			return edits[left].Range.Start.Line > edits[right].Range.Start.Line
		}
		return edits[left].Range.Start.Character > edits[right].Range.Start.Character
	})
	for _, edit := range edits {
		var ok bool
		source, ok = applyBufferChanges(source, []protocol.TextDocumentContentChangeEvent{{
			Range: &edit.Range, Text: edit.NewText,
		}})
		if !ok {
			t.Fatalf("completion edit %+v does not apply to source", edit)
		}
	}
	return source
}

func jsonNumber(value int) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
