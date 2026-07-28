package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

type diagnosticActionData struct {
	ID          string                    `json:"id"`
	RuleID      string                    `json:"ruleId"`
	Fixes       []api.IndexLintFix        `json:"fixes"`
	Suppression *api.IndexLintSuppression `json:"suppression"`
}

func (s *Server) codeAction(raw json.RawMessage) jsonrpc.HandlerResult {
	return s.codeActionRequest(context.Background(), nil, raw)
}

func (s *Server) codeActionRequest(
	ctx context.Context,
	id json.RawMessage,
	raw json.RawMessage,
) jsonrpc.HandlerResult {
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
	_, lintDocument := workspace.LeadingWhitespace(
		params.TextDocument.URI,
		params.Range.Start.Line,
	)

	s.mu.Lock()
	isVSCode := s.clientInfo != nil && strings.Contains(s.clientInfo.Name, "Visual Studio Code")
	trusted := s.trusted
	s.mu.Unlock()
	fixWorkspace, supportsFixes := workspace.(fixActionWorkspace)
	actions := make([]protocol.CodeAction, 0)
	for _, diagnostic := range params.Context.Diagnostics {
		if isPromptTextDiagnosticKind(diagnostic.Data) ||
			!lintDocument ||
			diagnostic.Source != "crux" {
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
		if trusted && supportsFixes && len(data.Fixes) > 0 {
			scopeRoot, finding, found := fixWorkspace.FindingForURI(params.TextDocument.URI, data.ID)
			if found {
				for fixIndex, diagnosticFix := range data.Fixes {
					if diagnosticFix.Command == "" || fixIndex >= len(finding.Fixes) {
						continue
					}
					fix := finding.Fixes[fixIndex]
					if _, allowed := allowedFixCommand(fix.Command); !allowed {
						continue
					}
					title := "Run `" + fix.Command + "` — " + fix.Title
					index := fixIndex
					actions = append(actions, protocol.CodeAction{
						Title:       title,
						Kind:        protocol.CodeActionQuickFix,
						Diagnostics: []protocol.Diagnostic{diagnostic},
						Command: &protocol.Command{
							Title: title, Command: runFixCommand,
							Arguments: []any{runFixArguments{
								ScopeRoot: scopeRoot, FindingID: data.ID, FixIndex: &index,
							}},
						},
					})
				}
			}
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
	locators := s.promptTextActionLocators(params)
	promptTextWorkspace, supportsPromptText :=
		workspace.(promptTextActionWorkspace)
	refactorWorkspace, supportsRefactor :=
		workspace.(promptTextRefactorWorkspace)
	refactorRequested := supportsRefactor &&
		s.promptTextRefactorRequested(params.Context.Only)
	if (len(locators) == 0 || !supportsPromptText) && !refactorRequested {
		return jsonrpc.HandlerResult{Result: actions}
	}
	queryContext, pending := s.registerPromptText(
		ctx,
		id,
		params.TextDocument.URI,
	)
	return jsonrpc.HandlerResult{Deferred: func() jsonrpc.HandlerResult {
		defer s.finishPromptText(pending)
		result := append([]protocol.CodeAction(nil), actions...)
		if len(locators) > 0 && supportsPromptText {
			contribution := promptTextWorkspace.PromptTextActions(
				queryContext,
				params.TextDocument.URI,
				locators,
			)
			result = append(result, contribution.Actions...)
		}
		if refactorRequested {
			contribution := refactorWorkspace.PromptTextStringRefactor(
				queryContext,
				params.TextDocument.URI,
				params.Range,
			)
			result = append(result, contribution.Actions...)
		}
		if errors.Is(
			context.Cause(queryContext),
			errPromptTextClientCancelled,
		) {
			return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
				Code: protocol.RequestCancelledCode, Message: "Request cancelled",
			}}
		}
		if queryContext.Err() != nil {
			return jsonrpc.HandlerResult{Result: actions}
		}
		return jsonrpc.HandlerResult{Result: result}
	}}
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
