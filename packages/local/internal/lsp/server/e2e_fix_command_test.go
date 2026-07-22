package server

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

const duplicateTargetRule = "runtime.duplicate_target_name"

func TestBinaryRunCommandJourneySeparatesGenerationFromManualRepair(t *testing.T) {
	binary := e2eBinary(t)
	root := copyFixtureProject(t)
	runtimeFile := filepath.Join(root, "src", "runtime.ts")
	originalSource := strings.Join([]string{
		"import { flow } from '@use-crux/core/flow'",
		"import { durableTask } from '@use-crux/core/runtime'",
		"",
		"export const reviewFlow = flow('review', async () => undefined)",
		"export const reviewTask = durableTask('review', { run: async () => undefined })",
		"",
	}, "\n")
	if err := os.WriteFile(runtimeFile, []byte(originalSource), 0o600); err != nil {
		t.Fatal(err)
	}

	manifestFile := filepath.Join(root, ".crux", "generated", "runtime", "manifest.json")
	privacyFile := filepath.Join(root, ".crux", "generated", "runtime", "privacy.json")
	assertFileMissing(t, manifestFile)
	assertFileMissing(t, privacyFile)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
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
		if t.Failed() {
			t.Logf("crux lsp stderr:\n%s", stderr.String())
		}
	})

	writer := jsonrpc.NewWriter(stdin)
	reader := jsonrpc.NewReader(stdout)
	rootURI := protocol.DocumentURI("file://" + filepath.ToSlash(root))
	runtimeURI := protocol.DocumentURI("file://" + filepath.ToSlash(runtimeFile))
	writeLSP(t, writer, map[string]any{
		"jsonrpc": "2.0", "id": 1, "method": protocol.MethodInitialize,
		"params": map[string]any{
			"rootUri": rootURI, "clientInfo": map[string]any{"name": "Visual Studio Code"},
		},
	})
	readUntil(t, reader, func(message map[string]json.RawMessage) bool { return string(message["id"]) == "1" })
	writeLSP(t, writer, map[string]any{"jsonrpc": "2.0", "method": protocol.MethodInitialized})
	writeLSP(t, writer, map[string]any{
		"jsonrpc": "2.0", "method": protocol.MethodDidOpen,
		"params": protocol.DidOpenTextDocumentParams{TextDocument: protocol.TextDocumentItem{
			URI: runtimeURI, LanguageID: "typescript", Version: 1, Text: originalSource,
		}},
	})

	diagnostic := waitForRuleDiagnostic(t, reader, runtimeURI, duplicateTargetRule)
	action := requestRunCommandAction(t, writer, reader, 2, runtimeURI, diagnostic)
	if action.Command == nil || action.Command.Title != action.Title ||
		action.Title != "Run `crux runtime generate` — Rename one runtime target" {
		t.Fatalf("run-command action = %#v", action)
	}
	linkWorkspaceDependencies(t, root)

	writeLSP(t, writer, map[string]any{
		"jsonrpc": "2.0", "id": 3, "method": protocol.MethodExecuteCommand,
		"params": protocol.ExecuteCommandParams{
			Command: action.Command.Command, Arguments: action.Command.Arguments,
		},
	})
	executeResponse, outcome := waitForCommandResponseAndOutcome(t, reader, "3")
	var commandResult protocol.ExecuteCommandResult
	if err := json.Unmarshal(executeResponse["result"], &commandResult); err != nil {
		t.Fatal(err)
	}
	if commandResult.OK || commandResult.ExitCode == 0 {
		t.Fatalf("early command result = %#v", commandResult)
	}
	wantOutcomePrefix := "Crux command failed (exit " + strconv.Itoa(commandResult.ExitCode) + "): "
	if outcome.Type != protocol.MessageTypeWarning || !strings.HasPrefix(outcome.Message, wantOutcomePrefix) {
		t.Fatalf("early command outcome = %#v", outcome)
	}

	// The command is a companion step: executing it does not repair authored source.
	requestRunCommandAction(t, writer, reader, 4, runtimeURI, diagnostic)
	assertFileMissing(t, manifestFile)
	assertFileMissing(t, privacyFile)

	correctedSource := strings.Replace(
		originalSource,
		"reviewTask = durableTask('review'",
		"reviewTask = durableTask('review-secondary'",
		1,
	)
	if correctedSource == originalSource {
		t.Fatal("manual correction did not change the runtime source")
	}
	writeLSP(t, writer, map[string]any{
		"jsonrpc": "2.0", "method": protocol.MethodDidChange,
		"params": protocol.DidChangeTextDocumentParams{
			TextDocument: protocol.VersionedTextDocumentIdentifier{
				TextDocumentIdentifier: protocol.TextDocumentIdentifier{URI: runtimeURI}, Version: 2,
			},
			ContentChanges: []protocol.TextDocumentContentChangeEvent{{Text: correctedSource}},
		},
	})
	synchronizeAfterDidChange(t, writer, reader, runtimeURI, diagnostic)
	if err := os.WriteFile(runtimeFile, []byte(correctedSource), 0o600); err != nil {
		t.Fatal(err)
	}
	runPinnedRuntimeGenerate(t, ctx, binary, root)
	assertGeneratedRuntimeArtifacts(t, manifestFile, privacyFile)

	writeLSP(t, writer, map[string]any{
		"jsonrpc": "2.0", "method": protocol.MethodDidSave,
		"params": protocol.DidSaveTextDocumentParams{
			TextDocument: protocol.TextDocumentIdentifier{URI: runtimeURI},
		},
	})
	waitForRuleRemoval(t, reader, runtimeURI, duplicateTargetRule)

	writeLSP(t, writer, map[string]any{"jsonrpc": "2.0", "id": 6, "method": protocol.MethodShutdown})
	readUntil(t, reader, func(message map[string]json.RawMessage) bool { return string(message["id"]) == "6" })
	writeLSP(t, writer, map[string]any{"jsonrpc": "2.0", "method": protocol.MethodExit})
	_ = stdin.Close()
	if err := command.Wait(); err != nil {
		t.Fatalf("crux lsp: %v\n%s", err, stderr.String())
	}
}

func synchronizeAfterDidChange(
	t *testing.T,
	writer *jsonrpc.Writer,
	reader *jsonrpc.Reader,
	uri protocol.DocumentURI,
	diagnostic protocol.Diagnostic,
) {
	t.Helper()
	writeLSP(t, writer, map[string]any{
		"jsonrpc": "2.0", "id": 5, "method": protocol.MethodHover,
		"params": protocol.HoverParams{
			TextDocument: protocol.TextDocumentIdentifier{URI: uri},
			Position:     diagnostic.Range.Start,
		},
	})
	readUntil(t, reader, func(message map[string]json.RawMessage) bool {
		return string(message["id"]) == "5"
	})
}

func runPinnedRuntimeGenerate(t *testing.T, ctx context.Context, binary, root string) {
	t.Helper()
	command := exec.CommandContext(ctx, binary, runtimeGenerateArguments(root)...)
	command.Dir = root
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("direct runtime generation: %v\n%s", err, output)
	}
}

func e2eBinary(t *testing.T) string {
	t.Helper()
	binary := os.Getenv("CRUX_LSP_E2E_BINARY")
	if binary == "" {
		t.Skip("set CRUX_LSP_E2E_BINARY to a built crux binary")
	}
	absolute, err := filepath.Abs(binary)
	if err != nil {
		t.Fatal(err)
	}
	return absolute
}

func linkWorkspaceDependencies(t *testing.T, root string) {
	t.Helper()
	modules, err := filepath.Abs(filepath.Join("..", "..", "..", "..", "..", "node_modules"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(modules, filepath.Join(root, "node_modules")); err != nil {
		t.Fatal(err)
	}
}

func requestRunCommandAction(
	t *testing.T,
	writer *jsonrpc.Writer,
	reader *jsonrpc.Reader,
	id int,
	uri protocol.DocumentURI,
	diagnostic protocol.Diagnostic,
) protocol.CodeAction {
	t.Helper()
	writeLSP(t, writer, map[string]any{
		"jsonrpc": "2.0", "id": id, "method": protocol.MethodCodeAction,
		"params": protocol.CodeActionParams{
			TextDocument: protocol.TextDocumentIdentifier{URI: uri},
			Range:        diagnostic.Range, Context: protocol.CodeActionContext{Diagnostics: []protocol.Diagnostic{diagnostic}},
		},
	})
	response := readUntil(t, reader, func(message map[string]json.RawMessage) bool {
		return string(message["id"]) == strconv.Itoa(id)
	})
	var actions []protocol.CodeAction
	if err := json.Unmarshal(response["result"], &actions); err != nil {
		t.Fatal(err)
	}
	for _, action := range actions {
		if action.Command != nil && action.Command.Command == runFixCommand {
			return action
		}
	}
	t.Fatalf("run-command action not found in %#v", actions)
	return protocol.CodeAction{}
}
