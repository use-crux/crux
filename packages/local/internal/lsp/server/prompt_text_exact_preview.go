package server

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
)

type promptTextExactPreviewWorkspace interface {
	PromptTextExactPreviewLink(
		context.Context,
		protocol.DocumentURI,
		string,
		protocol.Position,
	) lsprompttext.ExactPreviewLinkResult
}

func (s *Server) promptTextPreviewExactLink(
	ctx context.Context,
	id json.RawMessage,
	raw json.RawMessage,
) jsonrpc.HandlerResult {
	var params protocol.PromptTextPreviewExactLinkParams
	if decodeExactJSON(raw, &params) != nil || !validPromptTextExactLinkParams(params) {
		return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
			Code:    protocol.InvalidParamsCode,
			Message: "Invalid PromptText exact-preview link params",
		}}
	}
	document, open := s.buffers.Snapshot(params.URI)
	if !open {
		return jsonrpc.HandlerResult{Result: exactLinkUnavailable("document-not-open")}
	}
	expected := exactLinkRevision(params)
	if document.Revision != expected {
		return jsonrpc.HandlerResult{Result: exactLinkUnavailable("revision-mismatch")}
	}
	workspace, ok := s.currentWorkspace().(promptTextExactPreviewWorkspace)
	if !ok {
		return jsonrpc.HandlerResult{Result: exactLinkUnavailable("analysis-unavailable")}
	}
	file, err := mapping.URIToPath(string(params.URI))
	if err != nil {
		return jsonrpc.HandlerResult{Result: exactLinkUnavailable("analysis-unavailable")}
	}
	queryContext, pending := s.registerPromptText(ctx, id, params.URI)
	return jsonrpc.HandlerResult{Deferred: func() jsonrpc.HandlerResult {
		defer s.finishPromptText(pending)
		result := workspace.PromptTextExactPreviewLink(
			queryContext, params.URI, file, params.Position,
		)
		current, currentOpen := s.buffers.Snapshot(params.URI)
		if !currentOpen {
			return jsonrpc.HandlerResult{Result: exactLinkUnavailable("document-not-open")}
		}
		if queryContext.Err() != nil || current.Revision != expected ||
			result.Revision != current.Revision {
			return jsonrpc.HandlerResult{Result: exactLinkUnavailable("revision-mismatch")}
		}
		return jsonrpc.HandlerResult{Result: s.exactLinkResult(result)}
	}}
}

func (s *Server) exactLinkResult(result lsprompttext.ExactPreviewLinkResult) any {
	switch result.Kind {
	case lsprompttext.ExactPreviewLinkReady:
		s.mu.Lock()
		port := s.settings.Port
		s.mu.Unlock()
		return protocol.PromptTextPreviewExactLinkReadyResult{
			Kind: protocol.PromptTextPreviewExactLinkReady,
			URL: fmt.Sprintf(
				"http://localhost:%d/library/index/prompt/%s/preview",
				port,
				encodeURIComponent(result.DefinitionID),
			),
		}
	case lsprompttext.ExactPreviewLinkStaticOnly:
		reason := closedExactLinkStaticReason(result.Reason)
		return protocol.PromptTextPreviewExactLinkStaticResult{
			Kind:   protocol.PromptTextPreviewExactLinkStaticOnly,
			Reason: reason, Message: exactLinkStaticMessages[reason],
		}
	default:
		return exactLinkUnavailable(closedExactLinkUnavailableReason(result.Reason))
	}
}

func validPromptTextExactLinkParams(
	params protocol.PromptTextPreviewExactLinkParams,
) bool {
	return params.URI != "" &&
		params.OpenEpoch > 0 &&
		params.OpenEpoch <= promptTextMaximumSafeInteger &&
		params.Version >= 0 &&
		params.Version <= int64(promptTextMaximumLSPInteger) &&
		validPromptTextSourceHash(params.SourceHash) &&
		validPromptTextPosition(params.Position)
}

func exactLinkRevision(
	params protocol.PromptTextPreviewExactLinkParams,
) transient.Revision {
	return transient.Revision{
		OpenEpoch: params.OpenEpoch, Version: params.Version,
		SourceHash: params.SourceHash,
	}
}

var exactLinkStaticMessages = map[string]string{
	"context-owner":      "Contexts are static-preview-only until canonical context inspection is available.",
	"named-fragment":     "This PromptText is a named fragment. Open its canonical Prompt owner or use static preview.",
	"anonymous-fragment": "Anonymous PromptText fragments are static-preview-only.",
	"ownerless":          "This PromptText has no current canonical Prompt owner. Use static preview.",
}

var exactLinkUnavailableMessages = map[string]string{
	"document-not-open":    "The source document is not open.",
	"revision-mismatch":    "The source document changed before exact preview could open.",
	"analysis-unavailable": "Current semantic PromptText analysis is unavailable.",
	"template-not-found":   "No exact PromptText template was found at the cursor.",
	"template-ambiguous":   "The PromptText template at the cursor is ambiguous.",
	"template-unsupported": "This PromptText template is unsupported.",
	"owner-unavailable":    "A unique current canonical Prompt owner is unavailable.",
}

func exactLinkUnavailable(reason string) protocol.PromptTextPreviewExactLinkUnavailableResult {
	reason = closedExactLinkUnavailableReason(reason)
	return protocol.PromptTextPreviewExactLinkUnavailableResult{
		Kind:   protocol.PromptTextPreviewExactLinkUnavailable,
		Reason: reason, Message: exactLinkUnavailableMessages[reason],
	}
}

func closedExactLinkStaticReason(reason string) string {
	if _, ok := exactLinkStaticMessages[reason]; ok {
		return reason
	}
	return "ownerless"
}

func closedExactLinkUnavailableReason(reason string) string {
	if _, ok := exactLinkUnavailableMessages[reason]; ok {
		return reason
	}
	return "analysis-unavailable"
}

func encodeURIComponent(value string) string {
	const hex = "0123456789ABCDEF"
	var encoded strings.Builder
	for _, character := range []byte(value) {
		if character >= 'a' && character <= 'z' ||
			character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' ||
			strings.ContainsRune("-_.!~*'()", rune(character)) {
			encoded.WriteByte(character)
			continue
		}
		encoded.WriteByte('%')
		encoded.WriteByte(hex[character>>4])
		encoded.WriteByte(hex[character&0xf])
	}
	return encoded.String()
}
