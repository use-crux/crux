package server

import (
	"context"
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

const (
	promptTextMaximumSafeInteger = uint64(9_007_199_254_740_991)
	promptTextMaximumLSPInteger  = uint32(2_147_483_647)
)

type promptTextPreviewWorkspace interface {
	PromptTextStaticPreview(
		context.Context,
		protocol.DocumentURI,
		string,
		lsprompttext.PreviewTarget,
	) lsprompttext.PreviewResult
}

func (s *Server) promptTextPreviewStatic(
	ctx context.Context,
	id json.RawMessage,
	raw json.RawMessage,
) jsonrpc.HandlerResult {
	var params protocol.PromptTextPreviewStaticParams
	if decodeExactJSON(raw, &params) != nil || !validPromptTextPreviewParams(params) {
		return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
			Code:    protocol.InvalidParamsCode,
			Message: "Invalid PromptText static preview params",
		}}
	}
	document, open := s.buffers.Snapshot(params.URI)
	if !open {
		return jsonrpc.HandlerResult{Result: unavailableStaticPreview(
			params, protocol.PromptTextPreviewDocumentNotOpen,
		)}
	}
	if document.Revision != previewRevision(params) {
		return jsonrpc.HandlerResult{Result: unavailableStaticPreview(
			params, protocol.PromptTextPreviewRevisionMismatch,
		)}
	}
	workspace, ok := s.currentWorkspace().(promptTextPreviewWorkspace)
	if !ok {
		return jsonrpc.HandlerResult{Result: unavailableStaticPreview(
			params, protocol.PromptTextPreviewAnalysisUnavailable,
		)}
	}
	file, err := mapping.URIToPath(string(params.URI))
	if err != nil {
		return jsonrpc.HandlerResult{Result: unavailableStaticPreview(
			params, protocol.PromptTextPreviewAnalysisUnavailable,
		)}
	}
	queryContext, pending := s.registerPromptText(ctx, id, params.URI)
	return jsonrpc.HandlerResult{Deferred: func() jsonrpc.HandlerResult {
		defer s.finishPromptText(pending)
		result := workspace.PromptTextStaticPreview(
			queryContext, params.URI, file, previewTarget(params.Target),
		)
		current, currentOpen := s.buffers.Snapshot(params.URI)
		if !currentOpen {
			return jsonrpc.HandlerResult{Result: unavailableStaticPreview(
				params, protocol.PromptTextPreviewDocumentNotOpen,
			)}
		}
		if queryContext.Err() != nil ||
			current.Revision != previewRevision(params) ||
			result.Revision != current.Revision {
			return jsonrpc.HandlerResult{Result: unavailableStaticPreview(
				params, protocol.PromptTextPreviewRevisionMismatch,
			)}
		}
		return jsonrpc.HandlerResult{Result: staticPreviewResult(params, result)}
	}}
}

func staticPreviewResult(
	params protocol.PromptTextPreviewStaticParams,
	result lsprompttext.PreviewResult,
) any {
	stamp := previewResultStamp(params)
	switch result.Kind {
	case lsprompttext.PreviewResultReady:
		truncation := previewTruncation(result.Truncation)
		return protocol.PromptTextPreviewReadyResult{
			PromptTextPreviewResultStamp: stamp,
			Kind:                         protocol.PromptTextPreviewResultReady,
			Selection:                    previewSelection(result.Selection),
			RequestStatus: protocol.PromptTextPreviewStructuralStatus(
				result.RequestStatus,
			),
			TemplateStatus: protocol.PromptTextPreviewStructuralStatus(
				result.TemplateStatus,
			),
			PreviewStatus: protocol.PromptTextPreviewContentStatus(
				result.PreviewStatus,
			),
			Evidence: protocol.PromptTextPreviewEvidence(result.Evidence),
			Text:     result.Text, Truncation: truncation,
		}
	case lsprompttext.PreviewResultChoose:
		choices := make([]protocol.PromptTextPreviewSelection, 0, len(result.Choices))
		for _, choice := range result.Choices {
			choices = append(choices, previewSelection(choice))
		}
		return protocol.PromptTextPreviewChooseResult{
			PromptTextPreviewResultStamp: stamp,
			Kind:                         protocol.PromptTextPreviewResultChoose,
			RequestStatus: protocol.PromptTextPreviewStructuralStatus(
				result.RequestStatus,
			),
			Choices: choices,
		}
	default:
		return unavailableStaticPreview(
			params, previewUnavailableReason(result.Reason),
		)
	}
}

func previewTruncation(
	value *staticprotocol.PromptTextPreviewTruncation,
) *protocol.PromptTextPreviewTruncation {
	if value == nil {
		return nil
	}
	return &protocol.PromptTextPreviewTruncation{
		Reason: protocol.PromptTextPreviewTruncationReason(value.Reason),
		Limit:  value.Limit, EmittedBytes: value.EmittedBytes,
	}
}

func previewSelection(
	value lsprompttext.PreviewSelection,
) protocol.PromptTextPreviewSelection {
	return protocol.PromptTextPreviewSelection{
		Ordinal: value.Ordinal, Range: value.Range,
	}
}

func previewTarget(value protocol.PromptTextPreviewTarget) lsprompttext.PreviewTarget {
	target := lsprompttext.PreviewTarget{Kind: lsprompttext.PreviewTargetKind(value.Kind)}
	if value.Position != nil {
		target.Position = *value.Position
	}
	if value.Range != nil {
		target.Range = *value.Range
	}
	return target
}

func previewUnavailableReason(reason string) protocol.PromptTextPreviewUnavailableReason {
	for _, candidate := range [...]protocol.PromptTextPreviewUnavailableReason{
		protocol.PromptTextPreviewRequestUnsupported,
		protocol.PromptTextPreviewTemplateNotFound,
		protocol.PromptTextPreviewTemplateAmbiguous,
		protocol.PromptTextPreviewTemplateUnsupported,
		protocol.PromptTextPreviewUnavailable,
	} {
		if reason == string(candidate) {
			return candidate
		}
	}
	return protocol.PromptTextPreviewAnalysisUnavailable
}

func unavailableStaticPreview(
	params protocol.PromptTextPreviewStaticParams,
	reason protocol.PromptTextPreviewUnavailableReason,
) protocol.PromptTextPreviewUnavailableResult {
	return protocol.PromptTextPreviewUnavailableResult{
		PromptTextPreviewResultStamp: previewResultStamp(params),
		Kind:                         protocol.PromptTextPreviewResultUnavailable, Reason: reason,
	}
}

func previewResultStamp(
	params protocol.PromptTextPreviewStaticParams,
) protocol.PromptTextPreviewResultStamp {
	return protocol.PromptTextPreviewResultStamp{
		ProtocolVersion: protocol.PromptTextProtocolVersion,
		URI:             params.URI, OpenEpoch: params.OpenEpoch,
		Version: params.Version, SourceHash: params.SourceHash,
	}
}

func previewRevision(params protocol.PromptTextPreviewStaticParams) transient.Revision {
	return transient.Revision{
		OpenEpoch: params.OpenEpoch, Version: params.Version, SourceHash: params.SourceHash,
	}
}

func validPromptTextPreviewParams(params protocol.PromptTextPreviewStaticParams) bool {
	if params.ProtocolVersion != protocol.PromptTextProtocolVersion ||
		params.URI == "" ||
		params.OpenEpoch == 0 ||
		params.OpenEpoch > promptTextMaximumSafeInteger ||
		params.Version < -2_147_483_648 ||
		params.Version > 2_147_483_647 ||
		!validPromptTextSourceHash(params.SourceHash) {
		return false
	}
	switch params.Target.Kind {
	case protocol.PromptTextPreviewTargetPosition:
		return params.Target.Position != nil &&
			params.Target.Range == nil &&
			validPromptTextPosition(*params.Target.Position)
	case protocol.PromptTextPreviewTargetTemplateRange:
		return params.Target.Range != nil &&
			params.Target.Position == nil &&
			validPromptTextRange(*params.Target.Range)
	default:
		return false
	}
}

func validPromptTextSourceHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') &&
			(character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func validPromptTextRange(value protocol.Range) bool {
	return validPromptTextPosition(value.Start) &&
		validPromptTextPosition(value.End) &&
		compareProtocolPosition(value.Start, value.End) < 0
}

func validPromptTextPosition(value protocol.Position) bool {
	return value.Line <= promptTextMaximumLSPInteger &&
		value.Character <= promptTextMaximumLSPInteger
}

func compareProtocolPosition(left, right protocol.Position) int {
	if left.Line < right.Line || (left.Line == right.Line && left.Character < right.Character) {
		return -1
	}
	if left == right {
		return 0
	}
	return 1
}
