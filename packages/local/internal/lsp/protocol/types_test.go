package protocol

import (
	"encoding/json"
	"testing"
)

func TestInitializeParamsRoundTripPinsWireNames(t *testing.T) {
	t.Parallel()

	input := []byte(`{"processId":42,"clientInfo":{"name":"Visual Studio Code","version":"1.100"},"rootUri":"file:///fallback","initializationOptions":{"crux":{"port":4401}},"workspaceFolders":[{"uri":"file:///repo","name":"repo"}]}`)
	var params InitializeParams
	if err := json.Unmarshal(input, &params); err != nil {
		t.Fatalf("unmarshal initialize params: %v", err)
	}
	output, err := json.Marshal(params)
	if err != nil {
		t.Fatalf("marshal initialize params: %v", err)
	}
	if string(output) != string(input) {
		t.Fatalf("initialize params = %s, want %s", output, input)
	}
}

func TestDiagnosticAndCodeActionRoundTripPinsWireNames(t *testing.T) {
	t.Parallel()

	input := []byte(`{"title":"Suppress prompt.missing_input_schema for this line","kind":"quickfix","diagnostics":[{"range":{"start":{"line":2,"character":0},"end":{"line":2,"character":6}},"severity":3,"code":"prompt.missing_input_schema","codeDescription":{"href":"https://cruxjs.dev/rule"},"source":"crux","message":"Prompt has no input schema","tags":[1],"data":{"ruleId":"prompt.missing_input_schema"}}],"edit":{"changes":{"file:///repo/src/writer.ts":[{"range":{"start":{"line":2,"character":0},"end":{"line":2,"character":0}},"newText":"// crux-lint-disable-next-line prompt.missing_input_schema -- reason\n"}]}},"command":{"title":"Open docs","command":"crux.openDocs","arguments":["https://cruxjs.dev/rule"]}}`)
	var action CodeAction
	if err := json.Unmarshal(input, &action); err != nil {
		t.Fatalf("unmarshal code action: %v", err)
	}
	output, err := json.Marshal(action)
	if err != nil {
		t.Fatalf("marshal code action: %v", err)
	}
	if string(output) != string(input) {
		t.Fatalf("code action = %s, want %s", output, input)
	}
}

func TestDidChangeParamsRoundTripPinsIncrementalAndFullDocumentChanges(t *testing.T) {
	t.Parallel()

	input := []byte(`{"textDocument":{"uri":"file:///repo/src/writer.ts","version":3},"contentChanges":[{"range":{"start":{"line":1,"character":2},"end":{"line":1,"character":4}},"rangeLength":2,"text":"😀"},{"text":"replacement"}]}`)
	var params DidChangeTextDocumentParams
	if err := json.Unmarshal(input, &params); err != nil {
		t.Fatalf("unmarshal didChange params: %v", err)
	}
	if params.ContentChanges[0].Range == nil || params.ContentChanges[1].Range != nil {
		t.Fatalf("content change ranges = %#v, want incremental then full-document", params.ContentChanges)
	}
	output, err := json.Marshal(params)
	if err != nil {
		t.Fatalf("marshal didChange params: %v", err)
	}
	if string(output) != string(input) {
		t.Fatalf("didChange params = %s, want %s", output, input)
	}
}

func TestExecuteCommandParamsAndResultPinWireNames(t *testing.T) {
	t.Parallel()

	params := ExecuteCommandParams{
		Command: "crux.runFix",
		Arguments: []any{map[string]any{
			"scopeRoot": "/repo", "findingId": "finding", "fixIndex": 0,
		}},
	}
	encodedParams, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(encodedParams), `{"command":"crux.runFix","arguments":[{"findingId":"finding","fixIndex":0,"scopeRoot":"/repo"}]}`; got != want {
		t.Fatalf("execute command params = %s, want %s", got, want)
	}

	result := ExecuteCommandResult{OK: false, ExitCode: 7, DurationMS: 25, StderrTail: "failed"}
	encodedResult, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(encodedResult), `{"ok":false,"exitCode":7,"durationMs":25,"stderrTail":"failed"}`; got != want {
		t.Fatalf("execute command result = %s, want %s", got, want)
	}
}

func TestJSONRPCRequestPreservesStringID(t *testing.T) {
	t.Parallel()

	input := []byte(`{"jsonrpc":"2.0","id":"request-1","method":"shutdown"}`)
	var request Request
	if err := json.Unmarshal(input, &request); err != nil {
		t.Fatalf("unmarshal request: %v", err)
	}
	if request.IsNotification() {
		t.Fatal("request with string id was classified as a notification")
	}
	output, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	if string(output) != string(input) {
		t.Fatalf("request = %s, want %s", output, input)
	}
}
