package runtimebridge

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"time"
)

func (s *Service) dispatchWS(ctx context.Context, state *peerState, command CommandRequest) (DispatchResponse, error) {
	if state.send == nil {
		return DispatchResponse{}, ErrNoPeer
	}
	ch := make(chan commandReply, 1)
	s.mu.Lock()
	if s.peers[state.peer.PeerID] != state {
		s.mu.Unlock()
		return DispatchResponse{}, ErrNoPeer
	}
	state.pending[command.CommandID] = &pendingCommand{reply: ch}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		if current := state.pending[command.CommandID]; current != nil && current.reply == ch {
			delete(state.pending, command.CommandID)
		}
		s.mu.Unlock()
	}()
	data, err := json.Marshal(command)
	if err != nil {
		return DispatchResponse{}, err
	}
	if err := state.send(ctx, data); err != nil {
		return DispatchResponse{}, err
	}
	s.publish(Event{Type: "runtime_bridge:event", Action: "command.sent", PeerID: state.peer.PeerID, CommandID: command.CommandID, Timestamp: time.Now().UTC()})
	select {
	case <-ctx.Done():
		return DispatchResponse{}, ctx.Err()
	case reply, ok := <-ch:
		if !ok {
			return DispatchResponse{}, ErrNoPeer
		}
		if reply.localErr != nil {
			return DispatchResponse{}, reply.localErr
		}
		resp := replyResponse(state.peer.PeerID, reply)
		s.publishCommandTerminalEvent(state.peer.PeerID, command.CommandID, resp.Error)
		return resp, nil
	}
}

func (s *Service) dispatchHTTP(ctx context.Context, peer Peer, command CommandRequest) (DispatchResponse, error) {
	if peer.EndpointURL == "" {
		return DispatchResponse{}, ErrNoPeer
	}
	if !IsLoopbackEndpoint(peer.EndpointURL) {
		return DispatchResponse{}, ErrPeerEndpointNotAllowed
	}
	data, err := json.Marshal(command)
	if err != nil {
		return DispatchResponse{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, peer.EndpointURL, bytes.NewReader(data))
	if err != nil {
		return DispatchResponse{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	s.publish(Event{Type: "runtime_bridge:event", Action: "command.sent", PeerID: peer.PeerID, CommandID: command.CommandID, Timestamp: time.Now().UTC()})
	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return DispatchResponse{}, err
	}
	defer resp.Body.Close()
	var raw json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return DispatchResponse{}, err
	}
	var envelope CommandEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return DispatchResponse{}, err
	}
	if envelope.Type == "command.error" {
		var commandErr CommandError
		_ = json.Unmarshal(raw, &commandErr)
		out := DispatchResponse{PeerID: peer.PeerID, Error: &commandErr}
		s.publishCommandTerminalEvent(peer.PeerID, command.CommandID, out.Error)
		return out, nil
	}
	var result CommandResult
	_ = json.Unmarshal(raw, &result)
	out := DispatchResponse{PeerID: peer.PeerID, Result: result.Result, RunIDs: result.RunIDs, TraceIDs: result.TraceIDs}
	s.publishCommandTerminalEvent(peer.PeerID, command.CommandID, out.Error)
	return out, nil
}

func (s *Service) selectPeer(req DispatchRequest) (*peerState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if req.PeerID != "" {
		state := s.peers[req.PeerID]
		if state == nil {
			return nil, ErrNoPeer
		}
		if !peerSupports(state.peer, req.Command) {
			return nil, ErrNoCapability
		}
		return state, nil
	}
	peerIDs := make([]string, 0, len(s.peers))
	for peerID := range s.peers {
		peerIDs = append(peerIDs, peerID)
	}
	sort.Strings(peerIDs)
	for _, peerID := range peerIDs {
		state := s.peers[peerID]
		if peerSupports(state.peer, req.Command) {
			return state, nil
		}
	}
	return nil, ErrNoPeer
}

func peerSupports(peer Peer, command string) bool {
	for _, capability := range peer.Capabilities {
		if capability.Command == command {
			return true
		}
	}
	return false
}

func replyResponse(peerID string, reply commandReply) DispatchResponse {
	if reply.err != nil {
		return DispatchResponse{PeerID: peerID, Error: reply.err}
	}
	if reply.result == nil {
		return DispatchResponse{PeerID: peerID}
	}
	return DispatchResponse{PeerID: peerID, Result: reply.result.Result, RunIDs: reply.result.RunIDs, TraceIDs: reply.result.TraceIDs}
}

func (s *Service) publishCommandTerminalEvent(peerID, commandID string, commandErr *CommandError) {
	if commandErr != nil {
		s.publish(Event{Type: "runtime_bridge:event", Action: "command.failed", PeerID: peerID, CommandID: commandID, Error: commandErr, Timestamp: time.Now().UTC()})
		return
	}
	s.publish(Event{Type: "runtime_bridge:event", Action: "command.completed", PeerID: peerID, CommandID: commandID, Timestamp: time.Now().UTC()})
}
