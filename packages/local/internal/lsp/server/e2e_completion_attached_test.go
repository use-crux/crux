package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestBinaryAttachedCompletionCoversFirstPartyReferenceShapes(t *testing.T) {
	binary := os.Getenv("CRUX_LSP_E2E_BINARY")
	if binary == "" {
		t.Skip("set CRUX_LSP_E2E_BINARY to a built crux binary")
	}
	var err error
	binary, err = filepath.Abs(binary)
	if err != nil {
		t.Fatal(err)
	}
	root := copyFixtureProject(t)
	file := filepath.Join(root, "src", "completion-attached.ts")
	if err := os.WriteFile(file, []byte(
		"import { context, prompt, tool } from '@use-crux/core'\n"+
			"import { agent } from '@use-crux/core/agent'\n"+
			"import { router } from '@use-crux/core/routing'\n"+
			"export const phaseEightBrand = context({ id: 'brand' })\n"+
			"export const phaseEightSearchTool = tool({ name: 'search' })\n"+
			"export const phaseEightWriter = prompt({ id: 'phase-eight-writer' })\n"+
			"export const phaseEightRouter = router({ id: 'quality', routes: { default: phaseEightWriter } })\n"+
			"export const draft = prompt({ id: 'draft', use: [phaseEightBrand], tools: { search: phaseEightSearchTool } })\n"+
			"export const support = agent({ id: 'support', prompt: phaseEightWriter, model: phaseEightRouter })\n",
	), 0o600); err != nil {
		t.Fatal(err)
	}
	port := availableCompletionPort(t)
	devContext, stopDev := context.WithCancel(context.Background())
	var devStderr bytes.Buffer
	dev := exec.CommandContext(devContext, binary, "dev", "--port", strconv.Itoa(port), "--no-tui")
	dev.Dir = root
	dev.Stderr = &devStderr
	if err := dev.Start(); err != nil {
		t.Fatal(err)
	}
	devDone := make(chan error, 1)
	go func() { devDone <- dev.Wait() }()
	t.Cleanup(func() {
		stopDev()
		select {
		case <-devDone:
		case <-time.After(5 * time.Second):
			_ = dev.Process.Kill()
		}
	})
	waitForAttachedDefinition(t, port, "prompt:phase-eight-writer", devDone, &devStderr)

	dirtyText := "import { context, prompt, tool } from '@use-crux/core'\n" +
		"import { agent } from '@use-crux/core/agent'\n" +
		"import { router } from '@use-crux/core/routing'\n" +
		"export const phaseEightBrand = context({ id: 'brand' })\n" +
		"export const phaseEightSearchTool = tool({ name: 'search' })\n" +
		"export const phaseEightWriter = prompt({ id: 'phase-eight-writer' })\n" +
		"export const phaseEightRouter = router({ id: 'quality', routes: { default: phaseEightWriter } })\n" +
		"export const draft = prompt({ id: 'draft', use: [phaseEightBra], tools: { phaseEightSea } })\n" +
		"export const support = agent({ id: 'support', prompt: phaseEightWri, model: phaseEightRou })\n"
	lspContext, stopLSP := context.WithTimeout(context.Background(), 45*time.Second)
	defer stopLSP()
	lsp := exec.CommandContext(lspContext, binary, "lsp", "--port", strconv.Itoa(port), "--root", root)
	lsp.Dir = root
	stdin, err := lsp.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := lsp.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var lspStderr bytes.Buffer
	lsp.Stderr = &lspStderr
	if err := lsp.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if lsp.ProcessState == nil {
			_ = lsp.Process.Kill()
		}
	})

	writer := jsonrpc.NewWriter(stdin)
	reader := jsonrpc.NewReader(stdout)
	rootURI := protocol.DocumentURI("file://" + filepath.ToSlash(root))
	writeLSP(t, writer, map[string]any{
		"jsonrpc": "2.0", "id": 1, "method": protocol.MethodInitialize,
		"params": map[string]any{
			"rootUri": rootURI, "initializationOptions": map[string]any{"workspaceTrust": true},
		},
	})
	readUntil(t, reader, func(message map[string]json.RawMessage) bool { return string(message["id"]) == "1" })
	writeLSP(t, writer, map[string]any{"jsonrpc": "2.0", "method": protocol.MethodInitialized})
	uri := protocol.DocumentURI("file://" + filepath.ToSlash(file))
	writeLSP(t, writer, map[string]any{
		"jsonrpc": "2.0", "method": protocol.MethodDidOpen,
		"params": protocol.DidOpenTextDocumentParams{TextDocument: protocol.TextDocumentItem{
			URI: uri, LanguageID: "typescript", Version: 31, Text: dirtyText,
		}},
	})

	cases := []struct {
		needle, label, insert string
	}{
		{"use: [phaseEightBra", "phaseEightBrand", "phaseEightBrand"},
		{"tools: { phaseEightSea", "phaseEightSearchTool", "search: phaseEightSearchTool"},
		{"prompt: phaseEightWri", "phaseEightWriter", "phaseEightWriter"},
		{"model: phaseEightRou", "phaseEightRouter", "phaseEightRouter"},
	}
	var first protocol.CompletionItem
	for index, test := range cases {
		item := waitForE2ECompletionItem(
			t, writer, reader, uri,
			completionPositionAfter(t, dirtyText, test.needle),
			test.label, 500+index*100,
		)
		if item.TextEdit == nil || item.TextEdit.NewText != test.insert {
			t.Fatalf("%s attached completion = %+v, want insert %q\nLSP stderr:\n%s\ndev stderr:\n%s",
				test.needle, item, test.insert, lspStderr.String(), devStderr.String())
		}
		if index == 0 {
			first = item
		}
	}
	var data completionItemData
	if json.Unmarshal(first.Data, &data) != nil || data.DocumentVersion != 31 || data.IndexGeneration == 0 {
		t.Fatalf("attached completion data = %s, want V31 and nonzero hub generation", first.Data)
	}
	if !strings.Contains(lspStderr.String(), "mode ATTACHED") || strings.Contains(lspStderr.String(), "mode OWN") {
		t.Fatalf("LSP did not stay attached to the dev compiler:\n%s", lspStderr.String())
	}
	for name, logs := range map[string]string{"LSP": lspStderr.String(), "dev": devStderr.String()} {
		if bytes.Contains([]byte(logs), []byte("use: [phaseEightBra")) {
			t.Fatalf("unsaved completion source leaked to %s logs", name)
		}
	}

	writeLSP(t, writer, map[string]any{"jsonrpc": "2.0", "id": 999, "method": protocol.MethodShutdown})
	readUntil(t, reader, func(message map[string]json.RawMessage) bool { return string(message["id"]) == "999" })
	writeLSP(t, writer, map[string]any{"jsonrpc": "2.0", "method": protocol.MethodExit})
	_ = stdin.Close()
	if err := lsp.Wait(); err != nil {
		t.Fatalf("crux lsp: %v\n%s", err, lspStderr.String())
	}
}

func availableCompletionPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

func waitForAttachedDefinition(t *testing.T, port int, id string, devDone <-chan error, logs *bytes.Buffer) {
	t.Helper()
	url := fmt.Sprintf("http://127.0.0.1:%d/api/index", port)
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case err := <-devDone:
			t.Fatalf("crux dev exited before indexing: %v\n%s", err, logs.String())
		default:
		}
		response, err := http.Get(url)
		if err == nil {
			var index api.IndexData
			decodeErr := json.NewDecoder(response.Body).Decode(&index)
			_ = response.Body.Close()
			if response.StatusCode == http.StatusOK && decodeErr == nil {
				for _, definition := range index.Definitions {
					if definition.ID == id {
						return
					}
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("dev server never indexed %s\n%s", id, logs.String())
}
