package server

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode/utf16"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

const fixHelperModeEnvironment = "CRUX_LSP_FIX_HELPER_MODE"

func TestMain(m *testing.M) {
	if mode := os.Getenv(fixHelperModeEnvironment); mode != "" {
		runFixHelper(mode)
		return
	}
	os.Exit(m.Run())
}

func TestExecuteFixSpawnsPinnedOwnBinaryCommandAndReportsSuccess(t *testing.T) {
	root := t.TempDir()
	record := filepath.Join(t.TempDir(), "invocation.json")
	t.Setenv(fixHelperModeEnvironment, "success")
	t.Setenv("CRUX_LSP_FIX_HELPER_RECORD", record)

	workspace := &commandWorkspace{root: root, finding: commandFinding(), present: true}
	server := initializedCommandServer(t, workspace, true, helperExecutableOptions(t))
	result := executeFixRequest(server, root, "finding", 0)
	got, ok := result.Result.(protocol.ExecuteCommandResult)
	if !ok || !got.OK || got.ExitCode != 0 || got.DurationMS < 0 || got.StderrTail != "" {
		t.Fatalf("execute result = %#v", result)
	}

	var invocation struct {
		Args []string `json:"args"`
		Dir  string   `json:"dir"`
	}
	payload, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(payload, &invocation); err != nil {
		t.Fatal(err)
	}
	wantArgs := []string{"runtime", "generate", "--cwd", root, "--json"}
	if !reflect.DeepEqual(invocation.Args, wantArgs) || invocation.Dir != root {
		t.Fatalf("invocation = %#v, want args %v and dir %q", invocation, wantArgs, root)
	}
	assertShowMessage(t, server, protocol.MessageTypeInfo, "Crux command succeeded: crux runtime generate")
}

func TestExecuteFixReturnsFailureWithBoundedUTF16StderrTail(t *testing.T) {
	root := t.TempDir()
	t.Setenv(fixHelperModeEnvironment, "failure")
	workspace := &commandWorkspace{root: root, finding: commandFinding(), present: true}
	server := initializedCommandServer(t, workspace, true, helperExecutableOptions(t))

	result := executeFixRequest(server, root, "finding", 0)
	got, ok := result.Result.(protocol.ExecuteCommandResult)
	if !ok || got.OK || got.ExitCode != 7 || got.DurationMS < 0 {
		t.Fatalf("execute result = %#v", result)
	}
	if units := len(utf16.Encode([]rune(got.StderrTail))); units > 500 {
		t.Fatalf("stderr tail has %d UTF-16 units, want at most 500", units)
	}
	if !strings.HasSuffix(got.StderrTail, "😀tail\nsecond line\n") {
		t.Fatalf("stderr tail = %q, want complete suffix", got.StderrTail)
	}
	firstLine := strings.SplitN(got.StderrTail, "\n", 2)[0]
	assertShowMessage(t, server, protocol.MessageTypeWarning, "Crux command failed (exit 7): "+firstLine)
}

func TestExecuteFixRejectsSecondRequestWhileScopeIsBusy(t *testing.T) {
	root := t.TempDir()
	started := filepath.Join(t.TempDir(), "started")
	release := filepath.Join(t.TempDir(), "release")
	t.Setenv(fixHelperModeEnvironment, "block")
	t.Setenv("CRUX_LSP_FIX_HELPER_STARTED", started)
	t.Setenv("CRUX_LSP_FIX_HELPER_RELEASE", release)

	workspace := &commandWorkspace{root: root, finding: commandFinding(), present: true}
	server := initializedCommandServer(t, workspace, true, helperExecutableOptions(t))
	first := make(chan bool, 1)
	go func() {
		result := executeFixRequest(server, root, "finding", 0)
		value, ok := result.Result.(protocol.ExecuteCommandResult)
		first <- ok && value.OK
	}()
	waitForFile(t, started)

	result := executeFixRequest(server, root, "finding", 0)
	assertResponseError(t, result, protocol.RequestFailedCode, "another Crux fix is already running")
	if err := os.WriteFile(release, []byte("release"), 0o600); err != nil {
		t.Fatal(err)
	}
	if ok := <-first; !ok {
		t.Fatal("first fix did not complete successfully")
	}
}

func TestExecuteFixTransportReturnsBusyWhileFirstCommandRuns(t *testing.T) {
	root := t.TempDir()
	started := filepath.Join(t.TempDir(), "started")
	release := filepath.Join(t.TempDir(), "release")
	t.Setenv(fixHelperModeEnvironment, "block")
	t.Setenv("CRUX_LSP_FIX_HELPER_STARTED", started)
	t.Setenv("CRUX_LSP_FIX_HELPER_RELEASE", release)
	t.Cleanup(func() { _ = os.WriteFile(release, []byte("release"), 0o600) })

	workspace := &commandWorkspace{root: root, finding: commandFinding(), present: true}
	server := initializedCommandServer(t, workspace, true, helperExecutableOptions(t))
	inputReader, inputWriter := io.Pipe()
	outputReader, outputWriter := io.Pipe()
	done := make(chan error, 1)
	go func() {
		done <- jsonrpc.Serve(context.Background(), inputReader, outputWriter, io.Discard, server)
	}()
	writer := jsonrpc.NewWriter(inputWriter)
	writeExecuteFixFrame(t, writer, 1, root)
	waitForFile(t, started)
	writeExecuteFixFrame(t, writer, 2, root)

	response := make(chan map[string]json.RawMessage, 1)
	go func() {
		payload, err := jsonrpc.NewReader(outputReader).Read()
		if err != nil {
			response <- map[string]json.RawMessage{"readError": json.RawMessage(`true`)}
			return
		}
		var message map[string]json.RawMessage
		_ = json.Unmarshal(payload, &message)
		response <- message
	}()
	select {
	case message := <-response:
		if string(message["id"]) != "2" {
			t.Fatalf("first transport response = %#v, want busy id 2", message)
		}
		var responseError protocol.ResponseError
		if json.Unmarshal(message["error"], &responseError) != nil ||
			responseError.Code != protocol.RequestFailedCode || responseError.Message != busyFixMessage {
			t.Fatalf("busy transport error = %#v", message)
		}
	case <-time.After(time.Second):
		t.Fatal("second executeCommand was blocked behind the running process")
	}

	if err := os.WriteFile(release, []byte("release"), 0o600); err != nil {
		t.Fatal(err)
	}
	reader := jsonrpc.NewReader(outputReader)
	sawOutcome := false
	readUntil(t, reader, func(message map[string]json.RawMessage) bool {
		if string(message["method"]) == `"`+protocol.MethodShowMessage+`"` {
			sawOutcome = true
		}
		return string(message["id"]) == "1"
	})
	if !sawOutcome {
		readUntil(t, reader, func(message map[string]json.RawMessage) bool {
			return string(message["method"]) == `"`+protocol.MethodShowMessage+`"`
		})
	}
	_ = inputWriter.Close()
	if err := <-done; err != nil {
		t.Fatalf("serve executeCommand: %v", err)
	}
}

func TestBoundedStderrWriterKeepsOnlyUTF8Tail(t *testing.T) {
	writer := &boundedStderrWriter{}
	payload := []byte(strings.Repeat("x", boundedStderrBytes*3) + "😀tail\n")
	written, err := writer.Write(payload)
	if err != nil || written != len(payload) {
		t.Fatalf("Write = (%d, %v), want (%d, nil)", written, err, len(payload))
	}
	if len(writer.buffer) > boundedStderrBytes {
		t.Fatalf("buffered stderr bytes = %d, want <= %d", len(writer.buffer), boundedStderrBytes)
	}
	if got := writer.String(); !strings.HasSuffix(got, "😀tail\n") || len(utf16.Encode([]rune(got))) > 500 {
		t.Fatalf("stderr tail = %q", got)
	}
}

func writeExecuteFixFrame(t *testing.T, writer *jsonrpc.Writer, id int, root string) {
	t.Helper()
	params := protocol.ExecuteCommandParams{
		Command: runFixCommand,
		Arguments: []any{map[string]any{
			"scopeRoot": root, "findingId": "finding", "fixIndex": 0,
		}},
	}
	payload, err := json.Marshal(map[string]any{
		"jsonrpc": protocol.JSONRPCVersion, "id": id,
		"method": protocol.MethodExecuteCommand, "params": params,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := writer.Write(payload); err != nil {
		t.Fatal(err)
	}
}

func helperExecutableOptions(t *testing.T) Options {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return Options{FixExecutable: func() (string, error) { return executable, nil }}
}

func runFixHelper(mode string) {
	if record := os.Getenv("CRUX_LSP_FIX_HELPER_RECORD"); record != "" {
		cwd, _ := os.Getwd()
		payload, _ := json.Marshal(struct {
			Args []string `json:"args"`
			Dir  string   `json:"dir"`
		}{Args: os.Args[1:], Dir: cwd})
		_ = os.WriteFile(record, payload, 0o600)
	}
	switch mode {
	case "success":
		os.Exit(0)
	case "failure":
		_, _ = os.Stderr.WriteString(strings.Repeat("x", 510) + "😀tail\nsecond line\n")
		os.Exit(7)
	case "block":
		_ = os.WriteFile(os.Getenv("CRUX_LSP_FIX_HELPER_STARTED"), []byte("started"), 0o600)
		for {
			if _, err := os.Stat(os.Getenv("CRUX_LSP_FIX_HELPER_RELEASE")); err == nil {
				os.Exit(0)
			}
			time.Sleep(5 * time.Millisecond)
		}
	default:
		os.Exit(9)
	}
}

func waitForFile(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); err == nil {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", path)
}

func assertShowMessage(t *testing.T, server *Server, messageType protocol.MessageType, message string) {
	t.Helper()
	select {
	case notification := <-server.Outbound():
		params, ok := notification.Params.(protocol.LogMessageParams)
		if notification.Method != protocol.MethodShowMessage || !ok || params.Type != messageType || params.Message != message {
			t.Fatalf("notification = %#v, want showMessage (%d, %q)", notification, messageType, message)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for showMessage")
	}
}
