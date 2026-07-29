package runtimebridge

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge/preview"
)

type selectedPreviewPeer struct {
	state            *peerState
	peer             Peer
	target           preview.Target
	manifestRevision uint64
}

func (s *Service) dispatchPreview(ctx context.Context, request DispatchRequest) (DispatchResponse, error) {
	commandID := newID("cmd")
	payload, err := preview.DecodeDispatch(
		commandID, request.TargetID, request.Environment, request.CatalogueRevision,
		request.Payload, request.DeadlineMS,
	)
	if err != nil {
		return DispatchResponse{}, err
	}
	selected, err := s.selectPreviewPeer(request)
	if err != nil {
		return DispatchResponse{}, err
	}
	if selected.target.Input.Mode == "none" && len(payload.Input) != 0 {
		return DispatchResponse{}, preview.NewFailure("invalid_request")
	}
	deadlineMS := preview.EffectiveDeadline(request.DeadlineMS)
	ctx, cancel := context.WithTimeout(ctx, time.Duration(deadlineMS)*time.Millisecond)
	defer cancel()
	encodedPayload, err := json.Marshal(payload)
	if err != nil {
		return DispatchResponse{}, preview.NewFailure("invalid_request")
	}
	command := CommandRequest{
		Type: "command.request", CommandID: commandID,
		Command: preview.Command, TargetID: request.TargetID,
		CatalogueRevision: request.CatalogueRevision,
		Payload:           encodedPayload, DeadlineMS: deadlineMS,
	}
	if _, err := encodePreviewCommand(command); err != nil {
		return DispatchResponse{}, preview.NewFailure("invalid_request")
	}
	if selected.peer.Transport == TransportHTTP {
		response, err := s.dispatchPreviewHTTP(ctx, selected, command)
		annotatePreviewResponse(&response, selected, command.CatalogueRevision)
		s.publishPreviewTerminal(selected.peer.PeerID, command.CommandID, err)
		return response, err
	}
	response, err := s.dispatchPreviewWS(ctx, selected, command)
	annotatePreviewResponse(&response, selected, command.CatalogueRevision)
	s.publishPreviewTerminal(selected.peer.PeerID, command.CommandID, err)
	return response, err
}

func annotatePreviewResponse(
	response *DispatchResponse,
	selected selectedPreviewPeer,
	catalogueRevision uint64,
) {
	response.RuntimeName = selected.peer.RuntimeName
	response.PeerEnvironment = selected.peer.Environment
	response.CatalogueRevision = catalogueRevision
}

func (s *Service) selectPreviewPeer(request DispatchRequest) (selectedPreviewPeer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	candidates := make([]preview.Candidate, 0, len(s.peers))
	states := make(map[string]*peerState, len(s.peers))
	for peerID, state := range s.peers {
		states[peerID] = state
		candidates = append(candidates, preview.Candidate{
			PeerID: peerID, RuntimeName: state.peer.RuntimeName,
			Environment: state.peer.Environment, Capability: state.preview,
		})
	}
	candidate, err := preview.Select(
		candidates, request.PeerID, request.Environment,
		request.TargetID, request.CatalogueRevision,
	)
	if err != nil {
		return selectedPreviewPeer{}, err
	}
	state := states[candidate.PeerID]
	target, _ := findPreviewTarget(candidate.Capability, request.TargetID)
	return selectedPreviewPeer{
		state: state, peer: state.peer, target: target,
		manifestRevision: state.manifestRevision,
	}, nil
}

func (s *Service) dispatchPreviewWS(
	ctx context.Context,
	selected selectedPreviewPeer,
	command CommandRequest,
) (DispatchResponse, error) {
	state := selected.state
	if state.send == nil {
		return DispatchResponse{}, preview.NewFailure("peer_disconnected")
	}
	pending := &pendingCommand{
		reply: make(chan commandReply, 1), preview: true,
		manifestRevision:  selected.manifestRevision,
		targetID:          command.TargetID,
		catalogueRevision: command.CatalogueRevision,
	}
	s.mu.Lock()
	if currentErr := s.previewSelectionFailureLocked(selected, command); currentErr != nil {
		s.mu.Unlock()
		return DispatchResponse{}, currentErr
	}
	state.pending[command.CommandID] = pending
	s.mu.Unlock()
	defer s.removePending(state, command.CommandID, pending)

	data, err := encodePreviewCommand(command)
	if err != nil {
		return DispatchResponse{}, preview.NewFailure("invalid_request")
	}
	if err := state.send(ctx, data); err != nil {
		if ctx.Err() != nil {
			return DispatchResponse{}, contextFailure(ctx)
		}
		return DispatchResponse{}, preview.NewFailure("peer_disconnected")
	}
	s.publish(Event{
		Type: "runtime_bridge:event", Action: "command.sent",
		PeerID: selected.peer.PeerID, CommandID: command.CommandID,
		Timestamp: time.Now().UTC(),
	})
	select {
	case <-ctx.Done():
		s.sendPreviewCancel(state, command.CommandID, cancelReason(ctx))
		failure := contextFailure(ctx)
		return DispatchResponse{}, failure
	case reply := <-pending.reply:
		if reply.localErr != nil {
			return DispatchResponse{}, reply.localErr
		}
		s.mu.Lock()
		currentErr := s.previewSelectionFailureLocked(selected, command)
		s.mu.Unlock()
		if currentErr != nil {
			return DispatchResponse{}, currentErr
		}
		response := replyResponse(selected.peer.PeerID, reply)
		return response, nil
	}
}

func (s *Service) dispatchPreviewHTTP(
	ctx context.Context,
	selected selectedPreviewPeer,
	command CommandRequest,
) (DispatchResponse, error) {
	peer := selected.peer
	if !IsLoopbackEndpoint(peer.EndpointURL) {
		return DispatchResponse{}, preview.NewFailure("endpoint_not_allowed")
	}
	if err := s.revalidateHTTPPreview(ctx, selected, command); err != nil {
		return DispatchResponse{}, err
	}
	data, err := encodePreviewCommand(command)
	if err != nil {
		return DispatchResponse{}, preview.NewFailure("invalid_request")
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, peer.EndpointURL, bytes.NewReader(data),
	)
	if err != nil {
		return DispatchResponse{}, preview.NewFailure("invalid_request")
	}
	request.Header.Set("Content-Type", "application/json")
	s.publish(Event{
		Type: "runtime_bridge:event", Action: "command.sent",
		PeerID: peer.PeerID, CommandID: command.CommandID,
		Timestamp: time.Now().UTC(),
	})
	response, err := s.doPreviewHTTP(request)
	if err != nil {
		return DispatchResponse{}, contextOrPeerFailure(ctx, err)
	}
	defer response.Body.Close()
	var raw json.RawMessage
	decoder := json.NewDecoder(io.LimitReader(response.Body, preview.MaxResultBytes+2049))
	if err := decoder.Decode(&raw); err != nil {
		return DispatchResponse{}, preview.NewFailure("invalid_response")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return DispatchResponse{}, preview.NewFailure("invalid_response")
	}
	decoded, err := preview.DecodeResponse(
		raw, command.CommandID, command.TargetID, command.CatalogueRevision,
	)
	if err != nil {
		return DispatchResponse{}, err
	}
	if err := s.revalidateHTTPPreview(ctx, selected, command); err != nil {
		return DispatchResponse{}, err
	}
	s.mu.Lock()
	currentErr := s.previewSelectionFailureLocked(selected, command)
	s.mu.Unlock()
	if currentErr != nil {
		return DispatchResponse{}, currentErr
	}
	if decoded.Error != nil {
		return DispatchResponse{}, preview.RuntimeFailure(decoded.Error)
	}
	return DispatchResponse{PeerID: peer.PeerID, Result: decoded.Result}, nil
}
