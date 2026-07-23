package server

import (
	"encoding/json"
	"errors"
	"os"
	"sort"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func waitForRuleDiagnostic(
	t *testing.T,
	reader *jsonrpc.Reader,
	uri protocol.DocumentURI,
	rule string,
) protocol.Diagnostic {
	t.Helper()
	var matched protocol.Diagnostic
	readUntil(t, reader, func(message map[string]json.RawMessage) bool {
		if stringValue(message["method"]) != protocol.MethodPublishDiagnostics {
			return false
		}
		var params protocol.PublishDiagnosticsParams
		if json.Unmarshal(message["params"], &params) != nil || params.URI != uri {
			return false
		}
		for _, diagnostic := range params.Diagnostics {
			if string(diagnostic.Code) == rule {
				matched = diagnostic
				return true
			}
		}
		return false
	})
	return matched
}

func waitForCommandResponseAndOutcome(
	t *testing.T,
	reader *jsonrpc.Reader,
	responseID string,
) (map[string]json.RawMessage, protocol.LogMessageParams) {
	t.Helper()
	var response map[string]json.RawMessage
	var outcome protocol.LogMessageParams
	readUntil(t, reader, func(message map[string]json.RawMessage) bool {
		if string(message["id"]) == responseID {
			response = message
		}
		if stringValue(message["method"]) == protocol.MethodShowMessage {
			_ = json.Unmarshal(message["params"], &outcome)
		}
		return response != nil && outcome.Message != ""
	})
	return response, outcome
}

func assertGeneratedRuntimeArtifacts(t *testing.T, manifestFile, privacyFile string) {
	t.Helper()
	manifestPayload, err := os.ReadFile(manifestFile)
	if err != nil {
		t.Fatalf("read generated manifest: %v", err)
	}
	var manifest struct {
		Targets []struct {
			Name string `json:"name"`
		} `json:"targets"`
	}
	if err := json.Unmarshal(manifestPayload, &manifest); err != nil {
		t.Fatalf("decode generated manifest: %v", err)
	}
	names := make([]string, len(manifest.Targets))
	for index, target := range manifest.Targets {
		names[index] = target.Name
	}
	sort.Strings(names)
	if len(names) != 2 || names[0] != "review" || names[1] != "review-secondary" {
		t.Fatalf("generated manifest target names = %v", names)
	}
	privacyPayload, err := os.ReadFile(privacyFile)
	if err != nil {
		t.Fatalf("read generated privacy artifact: %v", err)
	}
	if !json.Valid(privacyPayload) {
		t.Fatalf("generated privacy artifact is not JSON: %q", privacyPayload)
	}
}

func waitForRuleRemoval(
	t *testing.T,
	reader *jsonrpc.Reader,
	uri protocol.DocumentURI,
	rule string,
) {
	t.Helper()
	readUntil(t, reader, func(message map[string]json.RawMessage) bool {
		if stringValue(message["method"]) != protocol.MethodPublishDiagnostics {
			return false
		}
		var params protocol.PublishDiagnosticsParams
		if json.Unmarshal(message["params"], &params) != nil || params.URI != uri {
			return false
		}
		for _, diagnostic := range params.Diagnostics {
			if string(diagnostic.Code) == rule {
				return false
			}
		}
		return true
	})
}

func assertFileMissing(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected %s to be absent before command, got %v", path, err)
	}
}
