package server

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

type diagnosticActionData struct {
	ID          string                    `json:"id"`
	RuleID      string                    `json:"ruleId"`
	Suppression *api.IndexLintSuppression `json:"suppression"`
}

func (s *Server) codeAction(raw json.RawMessage) jsonrpc.HandlerResult {
	var params protocol.CodeActionParams
	if err := json.Unmarshal(raw, &params); err != nil || params.TextDocument.URI == "" {
		return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
			Code: protocol.InvalidParamsCode, Message: "Invalid code action params",
		}}
	}
	workspace := s.currentWorkspace()
	if workspace == nil {
		return jsonrpc.HandlerResult{Result: []protocol.CodeAction{}}
	}
	if _, ok := workspace.LeadingWhitespace(params.TextDocument.URI, params.Range.Start.Line); !ok {
		return jsonrpc.HandlerResult{Result: []protocol.CodeAction{}}
	}

	s.mu.Lock()
	isVSCode := s.clientInfo != nil && strings.Contains(s.clientInfo.Name, "Visual Studio Code")
	s.mu.Unlock()
	actions := make([]protocol.CodeAction, 0)
	for _, diagnostic := range params.Context.Diagnostics {
		if diagnostic.Source != "crux" {
			continue
		}
		var data diagnosticActionData
		if len(diagnostic.Data) == 0 || json.Unmarshal(diagnostic.Data, &data) != nil || data.RuleID == "" {
			continue
		}
		if canSuppress(diagnostic, data.Suppression) {
			indent, _ := workspace.LeadingWhitespace(params.TextDocument.URI, diagnostic.Range.Start.Line)
			directive := data.Suppression.Directive
			if directive == "" {
				directive = "// crux-lint-disable-next-line " + data.RuleID + " -- reason"
			}
			position := protocol.Position{Line: diagnostic.Range.Start.Line}
			actions = append(actions, protocol.CodeAction{
				Title:       "Suppress " + data.RuleID + " for this line",
				Kind:        protocol.CodeActionQuickFix,
				Diagnostics: []protocol.Diagnostic{diagnostic},
				Edit: &protocol.WorkspaceEdit{Changes: map[protocol.DocumentURI][]protocol.TextEdit{
					params.TextDocument.URI: {{
						Range:   protocol.Range{Start: position, End: position},
						NewText: indent + directive + "\n",
					}},
				}},
			})
		}
		if isVSCode && diagnostic.CodeDescription != nil && diagnostic.CodeDescription.Href != "" {
			href := string(diagnostic.CodeDescription.Href)
			actions = append(actions, protocol.CodeAction{
				Title: fmt.Sprintf("Open %s documentation", data.RuleID),
				Kind:  protocol.CodeActionQuickFix,
				Command: &protocol.Command{
					Title: "Open docs", Command: "crux.openDocs", Arguments: []any{href},
				},
			})
		}
	}
	return jsonrpc.HandlerResult{Result: actions}
}

func canSuppress(diagnostic protocol.Diagnostic, suppression *api.IndexLintSuppression) bool {
	if suppression == nil || !suppression.Supported || suppression.Scope != "next-line" {
		return false
	}
	for _, tag := range diagnostic.Tags {
		if tag == protocol.DiagnosticTagUnnecessary {
			return false
		}
	}
	return true
}
