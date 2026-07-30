package server

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

type promptTextLatestRunLinkWorkspace interface {
	PromptTextLatestRunLink(
		context.Context,
		protocol.DocumentURI,
		string,
		protocol.Position,
	) lsprompttext.LatestRunLinkResult
}

func (s *Server) promptTextOpenLatestRunLink(
	ctx context.Context,
	id json.RawMessage,
	raw json.RawMessage,
) jsonrpc.HandlerResult {
	var params protocol.PromptTextOpenLatestRunLinkParams
	if decodeExactJSON(raw, &params) != nil ||
		!validPromptTextExactLinkParams(params) {
		return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
			Code:    protocol.InvalidParamsCode,
			Message: "Invalid PromptText latest-Run link params",
		}}
	}
	document, open := s.buffers.Snapshot(params.URI)
	if !open {
		return jsonrpc.HandlerResult{Result: latestRunLinkUnavailable(
			"document-not-open",
		)}
	}
	expected := exactLinkRevision(params)
	if document.Revision != expected {
		return jsonrpc.HandlerResult{Result: latestRunLinkUnavailable(
			"revision-mismatch",
		)}
	}
	workspace, ok := s.currentWorkspace().(promptTextLatestRunLinkWorkspace)
	if !ok {
		return jsonrpc.HandlerResult{Result: latestRunLinkUnavailable(
			"analysis-unavailable",
		)}
	}
	file, err := mapping.URIToPath(string(params.URI))
	if err != nil {
		return jsonrpc.HandlerResult{Result: latestRunLinkUnavailable(
			"analysis-unavailable",
		)}
	}
	queryContext, pending := s.registerPromptText(ctx, id, params.URI)
	return jsonrpc.HandlerResult{Deferred: func() jsonrpc.HandlerResult {
		defer s.finishPromptText(pending)
		result := workspace.PromptTextLatestRunLink(
			queryContext, params.URI, file, params.Position,
		)
		current, currentOpen := s.buffers.Snapshot(params.URI)
		if !currentOpen {
			return jsonrpc.HandlerResult{Result: latestRunLinkUnavailable(
				"document-not-open",
			)}
		}
		if queryContext.Err() != nil || current.Revision != expected ||
			result.Revision != current.Revision {
			return jsonrpc.HandlerResult{Result: latestRunLinkUnavailable(
				"revision-mismatch",
			)}
		}
		return jsonrpc.HandlerResult{Result: s.latestRunLinkResult(result)}
	}}
}

func (s *Server) latestRunLinkResult(
	result lsprompttext.LatestRunLinkResult,
) any {
	if result.Kind == lsprompttext.LatestRunLinkReady {
		s.mu.Lock()
		port := s.settings.Port
		s.mu.Unlock()
		return protocol.PromptTextOpenLatestRunLinkReadyResult{
			Kind: protocol.PromptTextOpenLatestRunLinkReady,
			URL: fmt.Sprintf(
				"http://localhost:%d/library/index/prompt/%s/latest-run",
				port,
				encodeURIComponent(result.DefinitionID),
			),
		}
	}
	return latestRunLinkUnavailable(result.Reason)
}

var latestRunLinkMessages = map[string]string{
	"context-owner":        "This PromptText belongs to a Context, not a canonical Prompt owner.",
	"named-fragment":       "This PromptText is a named fragment. Open its canonical Prompt owner.",
	"anonymous-fragment":   "Anonymous PromptText fragments have no canonical Prompt owner.",
	"ownerless":            "This PromptText has no current canonical Prompt owner.",
	"document-not-open":    exactLinkUnavailableMessages["document-not-open"],
	"revision-mismatch":    exactLinkUnavailableMessages["revision-mismatch"],
	"analysis-unavailable": exactLinkUnavailableMessages["analysis-unavailable"],
	"template-not-found":   exactLinkUnavailableMessages["template-not-found"],
	"template-ambiguous":   exactLinkUnavailableMessages["template-ambiguous"],
	"template-unsupported": exactLinkUnavailableMessages["template-unsupported"],
	"owner-unavailable":    exactLinkUnavailableMessages["owner-unavailable"],
}

func latestRunLinkUnavailable(
	reason string,
) protocol.PromptTextOpenLatestRunLinkUnavailableResult {
	message, ok := latestRunLinkMessages[reason]
	if !ok {
		reason = "analysis-unavailable"
		message = latestRunLinkMessages[reason]
	}
	return protocol.PromptTextOpenLatestRunLinkUnavailableResult{
		Kind:   protocol.PromptTextOpenLatestRunLinkUnavailable,
		Reason: reason, Message: message,
	}
}
