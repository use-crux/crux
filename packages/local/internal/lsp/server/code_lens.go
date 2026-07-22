package server

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

const openDevtoolsCommand = "crux.openDevtools"

type codeLensWorkspace interface {
	CodeLenses(protocol.DocumentURI, bool) []protocol.CodeLens
}

func (s *Server) codeLens(raw json.RawMessage) jsonrpc.HandlerResult {
	var params protocol.CodeLensParams
	if err := json.Unmarshal(raw, &params); err != nil || params.TextDocument.URI == "" {
		return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
			Code: protocol.InvalidParamsCode, Message: "Invalid code lens params",
		}}
	}
	s.mu.Lock()
	enabled := s.settings.CodeLensEnabled
	canOpenDevtools := s.openDevtoolsCommand
	workspace := s.workspace
	s.mu.Unlock()
	lenses := make([]protocol.CodeLens, 0)
	if !enabled {
		return jsonrpc.HandlerResult{Result: lenses}
	}
	if provider, ok := workspace.(codeLensWorkspace); ok {
		lenses = append(lenses, provider.CodeLenses(params.TextDocument.URI, canOpenDevtools)...)
	}
	return jsonrpc.HandlerResult{Result: lenses}
}

// CodeLenses returns finding counts from the most-specific workspace scope.
func (w *workspaceRuntime) CodeLenses(
	uri protocol.DocumentURI,
	canOpenDevtools bool,
) []protocol.CodeLens {
	session := w.navigationSession(uri)
	if session == nil {
		return []protocol.CodeLens{}
	}
	w.mu.Lock()
	clickable := session.mode == readmodel.ModeAttached && canOpenDevtools
	port := w.settings.Port
	w.mu.Unlock()
	return buildCodeLenses(session.publisher.DefinitionSummariesIn(uri), clickable, port)
}

func buildCodeLenses(
	summaries []definitionSummary,
	clickable bool,
	port int,
) []protocol.CodeLens {
	lenses := make([]protocol.CodeLens, 0)
	for _, summary := range summaries {
		if summary.FindingCount == 0 {
			continue
		}
		line := summary.Definition.Range.Start.Line
		title := "Crux: " + countLabel(summary.FindingCount, "finding", "findings")
		command := &protocol.Command{Title: title}
		if clickable {
			command.Command = openDevtoolsCommand
			command.Arguments = []any{definitionDevtoolsURL(summary, port)}
		}
		position := protocol.Position{Line: line}
		lenses = append(lenses, protocol.CodeLens{
			Range: protocol.Range{Start: position, End: position}, Command: command,
		})
	}
	return lenses
}

func definitionDevtoolsURL(summary definitionSummary, port int) string {
	root := fmt.Sprintf("http://localhost:%d/", port)
	definition := summary.Definition.Definition
	switch definition.Kind {
	case "prompt":
		return root + "library/index/" + encodeURLComponent(definition.ID)
	case "context":
		return root + "library/index/context/" + encodeURLComponent(definition.ID)
	case "tool":
		return root + "library/index/tool/" + encodeURLComponent(definition.ID)
	default:
		return root
	}
}

func encodeURLComponent(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}
