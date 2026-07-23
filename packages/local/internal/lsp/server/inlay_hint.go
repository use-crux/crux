package server

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

type inlayHintWorkspace interface {
	InlayHints(protocol.DocumentURI, protocol.Range) []protocol.InlayHint
}

func (s *Server) inlayHint(raw json.RawMessage) jsonrpc.HandlerResult {
	var params protocol.InlayHintParams
	if err := json.Unmarshal(raw, &params); err != nil || params.TextDocument.URI == "" {
		return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
			Code: protocol.InvalidParamsCode, Message: "Invalid inlay hint params",
		}}
	}
	s.mu.Lock()
	enabled := s.settings.InlayHintsEnabled
	workspace := s.workspace
	s.mu.Unlock()
	hints := make([]protocol.InlayHint, 0)
	if !enabled {
		return jsonrpc.HandlerResult{Result: hints}
	}
	if provider, ok := workspace.(inlayHintWorkspace); ok {
		hints = append(hints, provider.InlayHints(params.TextDocument.URI, params.Range)...)
	}
	return jsonrpc.HandlerResult{Result: hints}
}

// InlayHints returns finding badges for displayed definitions in the most
// specific configured workspace scope containing uri.
func (w *workspaceRuntime) InlayHints(
	uri protocol.DocumentURI,
	range_ protocol.Range,
) []protocol.InlayHint {
	publisher := w.navigationPublisher(uri)
	if publisher == nil {
		return []protocol.InlayHint{}
	}
	return buildInlayHints(publisher.DefinitionSummariesIn(uri), range_)
}

func buildInlayHints(
	summaries []definitionSummary,
	range_ protocol.Range,
) []protocol.InlayHint {
	hints := make([]protocol.InlayHint, 0)
	for _, summary := range summaries {
		position := summary.Definition.FirstLineEnd
		if summary.FindingCount == 0 || !rangeContainsPosition(range_, position) {
			continue
		}
		tooltip := definitionTooltip(summary)
		hints = append(hints, protocol.InlayHint{
			Position:    position,
			Label:       "⚑ " + countLabel(summary.FindingCount, "finding", "findings"),
			Tooltip:     &tooltip,
			PaddingLeft: true,
		})
	}
	return hints
}

func definitionTooltip(summary definitionSummary) protocol.MarkupContent {
	var writer cappedHoverWriter
	for index, section := range definitionHoverSections(summary, protocol.MarkupKindMarkdown) {
		separator := "\n\n"
		if index == 0 {
			separator = ""
		}
		if !writer.append(section, separator) {
			break
		}
	}
	return protocol.MarkupContent{Kind: protocol.MarkupKindMarkdown, Value: writer.String()}
}
