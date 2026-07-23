package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

const completionLimit = 100

type pendingCompletion struct {
	cancel context.CancelFunc
	key    string
	uri    protocol.DocumentURI
}

type completionItemData struct {
	DocumentVersion int    `json:"documentVersion"`
	IndexGeneration uint64 `json:"indexGeneration"`
	DefinitionID    string `json:"definitionId"`
}

func (s *Server) completion(
	ctx context.Context,
	id json.RawMessage,
	raw json.RawMessage,
) jsonrpc.HandlerResult {
	var params protocol.CompletionParams
	if json.Unmarshal(raw, &params) != nil || params.TextDocument.URI == "" {
		s.traceCompletionOutcome(ctx, "invalid_params")
		return jsonrpc.HandlerResult{Error: &protocol.ResponseError{
			Code: protocol.InvalidParamsCode, Message: "Invalid completion params",
		}}
	}
	s.mu.Lock()
	trusted := s.trusted
	s.mu.Unlock()
	if !trusted {
		s.traceCompletionOutcome(ctx, completionReasonUntrusted)
		return jsonrpc.HandlerResult{Result: emptyCompletionList()}
	}
	document, ok := s.buffers.Snapshot(params.TextDocument.URI)
	if !ok {
		s.traceCompletionOutcome(ctx, completionReasonBufferUnavailable)
		return jsonrpc.HandlerResult{Result: emptyCompletionList()}
	}
	workspace, ok := s.currentWorkspace().(completionWorkspace)
	if !ok {
		s.traceCompletionOutcome(ctx, completionReasonWorkspaceUnavailable)
		return jsonrpc.HandlerResult{Result: emptyCompletionList()}
	}
	file, err := mapping.URIToPath(string(params.TextDocument.URI))
	if err != nil {
		s.traceCompletionOutcome(ctx, completionReasonInvalidURI)
		return jsonrpc.HandlerResult{Result: emptyCompletionList()}
	}
	queryContext, pending := s.registerCompletion(ctx, id, params.TextDocument.URI)
	return jsonrpc.HandlerResult{Deferred: func() jsonrpc.HandlerResult {
		defer s.finishCompletion(pending)
		outcome := workspace.Completion(queryContext, params.TextDocument.URI, readmodel.CompletionRequest{
			File: file, DocumentVersion: document.Version,
			LanguageID: document.LanguageID, Text: document.Text,
			Position: readmodel.CompletionPosition{
				Line: params.Position.Line, Character: params.Position.Character,
			},
			Limit: completionLimit,
		})
		if outcome.Kind == completionOutcomeWorkerFailureThreshold {
			s.warnCompletionFailure(queryContext)
		}
		result := outcome.Result
		if outcome.Kind != completionOutcomeCurrent {
			s.traceCompletionOutcome(ctx, outcome.Reason)
			return jsonrpc.HandlerResult{Result: emptyCompletionList()}
		}
		if queryContext.Err() != nil {
			reason := completionReasonCanceled
			if errors.Is(queryContext.Err(), context.DeadlineExceeded) {
				reason = completionReasonTimeout
			}
			s.traceCompletionOutcome(ctx, reason)
			return jsonrpc.HandlerResult{Result: emptyCompletionList()}
		}
		if result.DocumentVersion != document.Version ||
			!s.documentVersionCurrent(document) {
			s.traceCompletionOutcome(ctx, completionReasonStaleDocument)
			return jsonrpc.HandlerResult{Result: emptyCompletionList()}
		}
		s.traceCompletionOutcome(ctx, outcome.Reason)
		return jsonrpc.HandlerResult{Result: completionList(result, document.Version)}
	}}
}

func (s *Server) traceCompletionOutcome(
	ctx context.Context,
	reason completionOutcomeReason,
) {
	if reason == "" {
		reason = completionReasonSourceUnavailable
	}
	s.traceMessage(ctx, "completion outcome="+string(reason))
}

func completionList(result readmodel.CompletionResult, version int) protocol.CompletionList {
	items := make([]protocol.CompletionItem, 0, len(result.Items))
	for index, item := range result.Items {
		data, _ := json.Marshal(completionItemData{
			DocumentVersion: version, IndexGeneration: result.Generation, DefinitionID: item.ID,
		})
		items = append(items, protocol.CompletionItem{
			Label: item.Label, Kind: protocol.CompletionKindReference, Detail: item.Detail,
			SortText:   fmt.Sprintf("%04d:%s:%s", index, item.Label, item.ID),
			FilterText: item.Label,
			TextEdit: &protocol.TextEdit{
				Range: protocol.Range{
					Start: protocol.Position{Line: item.Replacement.Start.Line, Character: item.Replacement.Start.Character},
					End:   protocol.Position{Line: item.Replacement.End.Line, Character: item.Replacement.End.Character},
				},
				NewText: item.InsertText,
			},
			AdditionalTextEdits: completionAdditionalTextEdits(item.AdditionalTextEdits),
			Data:                data,
		})
	}
	return protocol.CompletionList{IsIncomplete: result.IsIncomplete, Items: items}
}

func completionAdditionalTextEdits(edits []readmodel.CompletionTextEdit) []protocol.TextEdit {
	if len(edits) == 0 {
		return nil
	}
	result := make([]protocol.TextEdit, 0, len(edits))
	for _, edit := range edits {
		result = append(result, protocol.TextEdit{
			Range: protocol.Range{
				Start: protocol.Position{Line: edit.Range.Start.Line, Character: edit.Range.Start.Character},
				End:   protocol.Position{Line: edit.Range.End.Line, Character: edit.Range.End.Character},
			},
			NewText: edit.NewText,
		})
	}
	return result
}

func (s *Server) documentVersionCurrent(snapshot documentSnapshot) bool {
	current, ok := s.buffers.Snapshot(snapshot.URI)
	return ok && current.Version == snapshot.Version
}

func emptyCompletionList() protocol.CompletionList {
	return protocol.CompletionList{IsIncomplete: true, Items: []protocol.CompletionItem{}}
}

func (s *Server) registerCompletion(
	parent context.Context,
	id json.RawMessage,
	uri protocol.DocumentURI,
) (context.Context, *pendingCompletion) {
	ctx, cancel := context.WithCancel(parent)
	key := completionRequestKey(id)
	pending := &pendingCompletion{cancel: cancel, key: key, uri: uri}
	s.completionMu.Lock()
	previousID := s.pendingCompletions[key]
	previousURI := s.completionByURI[uri]
	s.pendingCompletions[key] = pending
	s.completionByURI[uri] = pending
	s.completionMu.Unlock()
	if previousID != nil {
		previousID.cancel()
	}
	if previousURI != nil && previousURI != previousID {
		previousURI.cancel()
	}
	return ctx, pending
}

func (s *Server) finishCompletion(pending *pendingCompletion) {
	s.completionMu.Lock()
	if s.pendingCompletions[pending.key] == pending {
		delete(s.pendingCompletions, pending.key)
	}
	if s.completionByURI[pending.uri] == pending {
		delete(s.completionByURI, pending.uri)
	}
	s.completionMu.Unlock()
	pending.cancel()
}

func (s *Server) cancelRequest(raw json.RawMessage) {
	var params protocol.CancelParams
	if json.Unmarshal(raw, &params) != nil {
		return
	}
	key := completionRequestKey(params.ID)
	s.completionMu.Lock()
	pending := s.pendingCompletions[key]
	s.completionMu.Unlock()
	if pending != nil {
		pending.cancel()
	}
}

func (s *Server) closeCompletionRequests() {
	s.completionMu.Lock()
	pending := s.pendingCompletions
	s.pendingCompletions = make(map[string]*pendingCompletion)
	s.completionByURI = make(map[protocol.DocumentURI]*pendingCompletion)
	s.completionMu.Unlock()
	for _, request := range pending {
		request.cancel()
	}
}

func (s *Server) cancelDocumentCompletion(uri protocol.DocumentURI) {
	s.completionMu.Lock()
	pending := s.completionByURI[uri]
	if pending != nil {
		delete(s.completionByURI, uri)
	}
	s.completionMu.Unlock()
	if pending != nil {
		pending.cancel()
	}
}

func completionRequestKey(id json.RawMessage) string {
	return strings.TrimSpace(string(id))
}
