package runtimebridge

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

var (
	ErrNoPeer       = errors.New("runtime bridge peer not found")
	ErrNoCapability = errors.New("runtime bridge peer does not support command")
)

type Sender func(context.Context, []byte) error

type Service struct {
	mu         sync.Mutex
	peers      map[string]*peerState
	subs       map[chan Event]struct{}
	httpClient *http.Client
	evalRunner EvalRunner
}

type peerState struct {
	peer    Peer
	send    Sender
	pending map[string]chan commandReply
}

type commandReply struct {
	result *CommandResult
	err    *CommandError
}

func NewService(client *http.Client) *Service {
	if client == nil {
		client = http.DefaultClient
	}
	return &Service{
		peers:      map[string]*peerState{},
		subs:       map[chan Event]struct{}{},
		httpClient: client,
	}
}

func (s *Service) WithEvalRunner(runner EvalRunner) *Service {
	s.mu.Lock()
	s.evalRunner = runner
	s.mu.Unlock()
	return s
}

func (s *Service) Subscribe(ctx context.Context) <-chan Event {
	ch := make(chan Event, 128)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	go func() {
		<-ctx.Done()
		s.mu.Lock()
		delete(s.subs, ch)
		close(ch)
		s.mu.Unlock()
	}()
	return ch
}

func (s *Service) RegisterPeer(peer Peer, send Sender) Peer {
	if peer.PeerID == "" {
		peer.PeerID = newID("peer")
	}
	if peer.RuntimeName == "" {
		peer.RuntimeName = "crux-runtime"
	}
	if peer.LastSeenAt.IsZero() {
		peer.LastSeenAt = time.Now().UTC()
	}
	s.mu.Lock()
	s.peers[peer.PeerID] = &peerState{peer: peer, send: send, pending: map[string]chan commandReply{}}
	s.mu.Unlock()
	slog.Info("runtime bridge peer registered", "peerId", peer.PeerID, "transport", peer.Transport, "runtimeName", peer.RuntimeName, "endpointUrl", peer.EndpointURL)
	s.publish(Event{Type: "runtime_bridge:event", Action: "peer.connected", PeerID: peer.PeerID, Peer: &peer, Timestamp: time.Now().UTC()})
	return peer
}

func (s *Service) UnregisterPeer(peerID string) {
	s.mu.Lock()
	state, ok := s.peers[peerID]
	if ok {
		delete(s.peers, peerID)
		for _, ch := range state.pending {
			close(ch)
		}
	}
	s.mu.Unlock()
	if ok {
		s.publish(Event{Type: "runtime_bridge:event", Action: "peer.disconnected", PeerID: peerID, Timestamp: time.Now().UTC()})
	}
}

func (s *Service) Peers() []Peer {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Peer, 0, len(s.peers))
	for _, state := range s.peers {
		out = append(out, state.peer)
	}
	return out
}

func (s *Service) Touch(peerID string) {
	s.mu.Lock()
	if state := s.peers[peerID]; state != nil {
		state.peer.LastSeenAt = time.Now().UTC()
	}
	s.mu.Unlock()
}

func (s *Service) HandlePeerMessage(peerID string, data []byte) error {
	var envelope CommandEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return fmt.Errorf("decode runtime bridge message: %w", err)
	}
	switch envelope.Type {
	case "runtime.heartbeat":
		s.Touch(peerID)
		return nil
	case "command.result":
		var result CommandResult
		if err := json.Unmarshal(data, &result); err != nil {
			return fmt.Errorf("decode bridge command result: %w", err)
		}
		s.resolve(peerID, result.CommandID, commandReply{result: &result})
		return nil
	case "command.error":
		var commandErr CommandError
		if err := json.Unmarshal(data, &commandErr); err != nil {
			return fmt.Errorf("decode bridge command error: %w", err)
		}
		s.resolve(peerID, commandErr.CommandID, commandReply{err: &commandErr})
		return nil
	default:
		return nil
	}
}

func (s *Service) Dispatch(ctx context.Context, req DispatchRequest) (DispatchResponse, error) {
	if req.Command == "eval.run" && req.PeerID == "" {
		if response, ok, err := s.dispatchLocalEval(ctx, req); ok || err != nil {
			return response, err
		}
	}
	state, err := s.selectPeer(req)
	if err != nil {
		return DispatchResponse{}, err
	}
	if req.DeadlineMS > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(req.DeadlineMS)*time.Millisecond)
		defer cancel()
	}
	commandID := newID("cmd")
	command := CommandRequest{
		Type:       "command.request",
		CommandID:  commandID,
		Command:    req.Command,
		TargetID:   req.TargetID,
		Payload:    req.Payload,
		DeadlineMS: req.DeadlineMS,
	}
	if state.peer.Transport == TransportHTTP {
		return s.dispatchHTTP(ctx, state.peer, command)
	}
	return s.dispatchWS(ctx, state, command)
}

func (s *Service) dispatchLocalEval(ctx context.Context, req DispatchRequest) (DispatchResponse, bool, error) {
	s.mu.Lock()
	runner := s.evalRunner
	s.mu.Unlock()
	if runner == nil {
		return DispatchResponse{}, false, nil
	}
	if req.DeadlineMS > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(req.DeadlineMS)*time.Millisecond)
		defer cancel()
	}
	evalReq, err := decodeEvalRunRequest(req)
	if err != nil {
		return DispatchResponse{}, true, err
	}
	commandID := newID("cmd")
	s.publish(Event{Type: "runtime_bridge:event", Action: "command.sent", PeerID: "local-eval-runner", CommandID: commandID, Timestamp: time.Now().UTC()})
	result, err := runner.RunEval(ctx, evalReq)
	if err != nil {
		return DispatchResponse{}, true, err
	}
	body, err := json.Marshal(map[string]any{
		"summary":        json.RawMessage(result.Summary),
		"export":         json.RawMessage(result.Export),
		"analysisPrompt": result.AnalysisPrompt,
		"experimentIds":  result.ExperimentIDs,
	})
	if err != nil {
		return DispatchResponse{}, true, err
	}
	s.publish(Event{Type: "runtime_bridge:event", Action: "command.completed", PeerID: "local-eval-runner", CommandID: commandID, Timestamp: time.Now().UTC()})
	return DispatchResponse{
		PeerID:   "local-eval-runner",
		Result:   body,
		RunIDs:   result.RunIDs,
		TraceIDs: result.TraceIDs,
	}, true, nil
}

func decodeEvalRunRequest(req DispatchRequest) (EvalRunRequest, error) {
	out := EvalRunRequest{
		TargetID:   req.TargetID,
		Payload:    req.Payload,
		DeadlineMS: req.DeadlineMS,
		Persist:    true,
	}
	if len(req.Payload) == 0 {
		return out, nil
	}
	var payload struct {
		SuiteID   string   `json:"suiteId,omitempty"`
		VariantID string   `json:"variantId,omitempty"`
		CaseIDs   []string `json:"caseIds,omitempty"`
		Persist   *bool    `json:"persist,omitempty"`
	}
	if err := json.Unmarshal(req.Payload, &payload); err != nil {
		return EvalRunRequest{}, fmt.Errorf("decode eval.run payload: %w", err)
	}
	out.SuiteID = payload.SuiteID
	out.VariantID = payload.VariantID
	out.CaseIDs = payload.CaseIDs
	if payload.Persist != nil {
		out.Persist = *payload.Persist
	}
	return out, nil
}

func (s *Service) dispatchWS(ctx context.Context, state *peerState, command CommandRequest) (DispatchResponse, error) {
	if state.send == nil {
		return DispatchResponse{}, ErrNoPeer
	}
	ch := make(chan commandReply, 1)
	s.mu.Lock()
	state.pending[command.CommandID] = ch
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(state.pending, command.CommandID)
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
		return replyResponse(state.peer.PeerID, reply), nil
	}
}

func (s *Service) dispatchHTTP(ctx context.Context, peer Peer, command CommandRequest) (DispatchResponse, error) {
	if peer.EndpointURL == "" {
		return DispatchResponse{}, ErrNoPeer
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
		return DispatchResponse{PeerID: peer.PeerID, Error: &commandErr}, nil
	}
	var result CommandResult
	_ = json.Unmarshal(raw, &result)
	return DispatchResponse{PeerID: peer.PeerID, Result: result.Result, RunIDs: result.RunIDs, TraceIDs: result.TraceIDs}, nil
}

func (s *Service) resolve(peerID, commandID string, reply commandReply) {
	s.mu.Lock()
	state := s.peers[peerID]
	var ch chan commandReply
	if state != nil {
		ch = state.pending[commandID]
	}
	s.mu.Unlock()
	if ch != nil {
		ch <- reply
	}
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
	for _, state := range s.peers {
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

func (s *Service) publish(event Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.subs {
		select {
		case ch <- event:
		default:
		}
	}
}

func newID(prefix string) string {
	var b [4]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("%s_%d_%s", prefix, time.Now().UnixMilli(), hex.EncodeToString(b[:]))
}
