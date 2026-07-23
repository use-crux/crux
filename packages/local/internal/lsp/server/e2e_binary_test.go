package server

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestBinarySuppressActionClearsFindingAfterSave(t *testing.T) {
	binary := os.Getenv("CRUX_LSP_E2E_BINARY")
	if binary == "" {
		t.Skip("set CRUX_LSP_E2E_BINARY to a built crux binary")
	}
	binary, err := filepath.Abs(binary)
	if err != nil {
		t.Fatal(err)
	}
	root := copyFixtureProject(t)
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

	writer := jsonrpc.NewWriter(stdin)
	reader := jsonrpc.NewReader(stdout)
	rootURI := protocol.DocumentURI("file://" + filepath.ToSlash(root))
	writeLSP(t, writer, map[string]any{
		"jsonrpc": "2.0", "id": 1, "method": "initialize",
		"params": map[string]any{
			"rootUri":    rootURI,
			"clientInfo": map[string]any{"name": "Visual Studio Code"},
		},
	})
	readUntil(t, reader, func(message map[string]json.RawMessage) bool { return string(message["id"]) == "1" })
	writeLSP(t, writer, map[string]any{"jsonrpc": "2.0", "method": "initialized"})

	writerURI := protocol.DocumentURI("file://" + filepath.ToSlash(filepath.Join(root, "src", "writer.ts")))
	var diagnostic protocol.Diagnostic
	readUntil(t, reader, func(message map[string]json.RawMessage) bool {
		if stringValue(message["method"]) != protocol.MethodPublishDiagnostics {
			return false
		}
		var params protocol.PublishDiagnosticsParams
		if json.Unmarshal(message["params"], &params) != nil || params.URI != writerURI || len(params.Diagnostics) == 0 {
			return false
		}
		diagnostic = params.Diagnostics[0]
		return true
	})

	writeLSP(t, writer, map[string]any{
		"jsonrpc": "2.0", "id": 2, "method": protocol.MethodCodeAction,
		"params": protocol.CodeActionParams{
			TextDocument: protocol.TextDocumentIdentifier{URI: writerURI},
			Range:        diagnostic.Range,
			Context:      protocol.CodeActionContext{Diagnostics: []protocol.Diagnostic{diagnostic}},
		},
	})
	response := readUntil(t, reader, func(message map[string]json.RawMessage) bool { return string(message["id"]) == "2" })
	var actions []protocol.CodeAction
	if err := json.Unmarshal(response["result"], &actions); err != nil || len(actions) == 0 || actions[0].Edit == nil {
		t.Fatalf("code actions = %s: %v", response["result"], err)
	}
	edit := actions[0].Edit.Changes[writerURI][0]
	applyInsertEdit(t, filepath.Join(root, "src", "writer.ts"), edit)
	writeLSP(t, writer, map[string]any{
		"jsonrpc": "2.0", "method": protocol.MethodDidSave,
		"params": protocol.DidSaveTextDocumentParams{TextDocument: protocol.TextDocumentIdentifier{URI: writerURI}},
	})
	readUntil(t, reader, func(message map[string]json.RawMessage) bool {
		if stringValue(message["method"]) != protocol.MethodPublishDiagnostics {
			return false
		}
		var params protocol.PublishDiagnosticsParams
		return json.Unmarshal(message["params"], &params) == nil && params.URI == writerURI && len(params.Diagnostics) == 0
	})

	writeLSP(t, writer, map[string]any{"jsonrpc": "2.0", "id": 3, "method": protocol.MethodShutdown})
	readUntil(t, reader, func(message map[string]json.RawMessage) bool { return string(message["id"]) == "3" })
	writeLSP(t, writer, map[string]any{"jsonrpc": "2.0", "method": protocol.MethodExit})
	_ = stdin.Close()
	if err := command.Wait(); err != nil {
		t.Fatalf("crux lsp: %v\n%s", err, stderr.String())
	}

	lint := exec.CommandContext(ctx, binary, "lint", "--json", "--root", root)
	output, err := lint.Output()
	if err != nil {
		t.Fatalf("crux lint loop closure: %v", err)
	}
	if bytes.Contains(output, []byte("lint:definition.missing_eval_coverage:prompt:lsp-fixture-writer")) {
		t.Fatal("suppressed finding remained after applying emitted directive")
	}
}

func copyFixtureProject(t *testing.T) string {
	t.Helper()
	source := filepath.Join("..", "testdata", "fixture-project")
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"crux.config.ts", "src/writer.ts", "src/suppressed.ts"} {
		content, err := os.ReadFile(filepath.Join(source, name))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, name), content, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func applyInsertEdit(t *testing.T, path string, edit protocol.TextEdit) {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(string(content), "\n")
	line := int(edit.Range.Start.Line)
	if line < 0 || line > len(lines) {
		t.Fatalf("edit line %d outside file", line)
	}
	updated := append([]string(nil), lines[:line]...)
	updated = append(updated, strings.TrimSuffix(edit.NewText, "\n"))
	updated = append(updated, lines[line:]...)
	if err := os.WriteFile(path, []byte(strings.Join(updated, "\n")), 0o600); err != nil {
		t.Fatal(err)
	}
}

func writeLSP(t *testing.T, writer *jsonrpc.Writer, value any) {
	t.Helper()
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := writer.Write(payload); err != nil {
		t.Fatal(err)
	}
}

func readUntil(t *testing.T, reader *jsonrpc.Reader, accept func(map[string]json.RawMessage) bool) map[string]json.RawMessage {
	t.Helper()
	for {
		result := make(chan struct {
			payload []byte
			err     error
		}, 1)
		go func() {
			payload, err := reader.Read()
			result <- struct {
				payload []byte
				err     error
			}{payload, err}
		}()
		select {
		case value := <-result:
			if value.err != nil {
				t.Fatal(value.err)
			}
			var message map[string]json.RawMessage
			if err := json.Unmarshal(value.payload, &message); err != nil {
				t.Fatal(err)
			}
			if accept(message) {
				return message
			}
		case <-time.After(30 * time.Second):
			t.Fatal("timed out waiting for LSP message")
		}
	}
}

func stringValue(raw json.RawMessage) string {
	var value string
	_ = json.Unmarshal(raw, &value)
	return value
}
