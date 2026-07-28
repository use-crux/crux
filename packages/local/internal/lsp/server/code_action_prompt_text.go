package server

import (
	"bytes"
	"encoding/json"
	"io"
	"regexp"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

var promptTextActionIDPattern = regexp.MustCompile(
	`^prompt-text:[0-9a-f]{64}$`,
)

type promptTextDiagnosticData struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// isPromptTextDiagnosticKind keeps malformed PromptText locators out of the
// permissive legacy lint-action path. Strict decoding still determines whether
// the diagnostic is eligible for PromptText regeneration.
func isPromptTextDiagnosticKind(data json.RawMessage) bool {
	var discriminator struct {
		Kind string `json:"kind"`
	}
	return len(data) > 0 &&
		json.Unmarshal(data, &discriminator) == nil &&
		discriminator.Kind == "prompt-text"
}

func (s *Server) promptTextActionLocators(
	params protocol.CodeActionParams,
) []promptTextActionLocator {
	s.mu.Lock()
	supported := s.diagnosticDataSupport && s.codeActionLiteralSupport
	s.mu.Unlock()
	if !supported || !quickFixRequested(params.Context.Only) {
		return nil
	}
	seen := make(map[promptTextActionLocator]struct{})
	result := make([]promptTextActionLocator, 0)
	for _, diagnostic := range params.Context.Diagnostics {
		data, ok := decodePromptTextDiagnosticData(diagnostic.Data)
		if !ok {
			continue
		}
		locator := promptTextActionLocator{
			ID: data.ID, DiagnosticRange: diagnostic.Range,
			RequestRange: params.Range,
		}
		if _, duplicate := seen[locator]; duplicate {
			continue
		}
		seen[locator] = struct{}{}
		result = append(result, locator)
	}
	return result
}

func decodePromptTextDiagnosticData(
	data json.RawMessage,
) (promptTextDiagnosticData, bool) {
	if len(data) == 0 {
		return promptTextDiagnosticData{}, false
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var result promptTextDiagnosticData
	if decoder.Decode(&result) != nil ||
		result.Kind != "prompt-text" ||
		!promptTextActionIDPattern.MatchString(result.ID) {
		return promptTextDiagnosticData{}, false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return promptTextDiagnosticData{}, false
	}
	return result, true
}

func quickFixRequested(only []protocol.CodeActionKind) bool {
	if len(only) == 0 {
		return true
	}
	for _, kind := range only {
		if kind == protocol.CodeActionQuickFix {
			return true
		}
	}
	return false
}
