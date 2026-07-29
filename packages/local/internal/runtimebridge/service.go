package runtimebridge

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge/preview"
)

var (
	ErrNoPeer                 = errors.New("runtime bridge peer not found")
	ErrNoCapability           = errors.New("runtime bridge peer does not support command")
	ErrPeerEndpointNotAllowed = errors.New("runtime bridge HTTP peer endpoint must be a loopback address")
)

// IsLoopbackEndpoint reports whether an HTTP peer endpoint URL targets the
// local loopback interface. Runtime peers are local app runtimes, so HTTP
// dispatch is confined to loopback to prevent the bridge from being used as a
// server-side request forgery (SSRF) proxy into other hosts.
func IsLoopbackEndpoint(endpoint string) bool {
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" {
		return false
	}
	host := u.Hostname()
	if strings.EqualFold(host, "localhost") {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

type Sender func(context.Context, []byte) error

type Service struct {
	mu                        sync.Mutex
	peers                     map[string]*peerState
	subs                      map[chan Event]struct{}
	httpClient                *http.Client
	logger                    *slog.Logger
	previewProjectionRevision uint64
}

type peerState struct {
	peer             Peer
	send             Sender
	preview          *preview.Capability
	connectionID     string
	manifestRevision uint64
	pending          map[string]*pendingCommand
}

type pendingCommand struct {
	reply             chan commandReply
	preview           bool
	manifestRevision  uint64
	targetID          string
	catalogueRevision uint64
}

type commandReply struct {
	result   *CommandResult
	err      *CommandError
	localErr error
}

// NewService creates an isolated runtime bridge service.
func NewService(client *http.Client, options ...Option) *Service {
	if client == nil {
		client = http.DefaultClient
	}
	service := &Service{
		peers:                     map[string]*peerState{},
		subs:                      map[chan Event]struct{}{},
		httpClient:                client,
		logger:                    slog.Default(),
		previewProjectionRevision: 1,
	}
	for _, option := range options {
		option(service)
	}
	return service
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

// ReplacePeerManifest atomically updates capabilities for one live connection.
func (s *Service) HandlePeerMessage(peerID string, data []byte) error {
	return s.HandlePeerConnectionMessage(peerID, "", data)
}

// HandlePeerConnectionMessage accepts data only from the active connection.
func (s *Service) HandlePeerConnectionMessage(peerID, connectionID string, data []byte) error {
	s.mu.Lock()
	state := s.peers[peerID]
	current := state != nil &&
		(connectionID == "" || state.connectionID == connectionID)
	s.mu.Unlock()
	if !current {
		return ErrNoPeer
	}
	var envelope CommandEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return fmt.Errorf("decode runtime bridge message: %w", err)
	}
	switch envelope.Type {
	case "runtime.heartbeat":
		s.touchPeerConnection(peerID, connectionID)
		return nil
	case "runtime.hello":
		var hello RuntimeHello
		if err := json.Unmarshal(data, &hello); err != nil || hello.Peer.PeerID != peerID {
			return fmt.Errorf("decode runtime bridge hello replacement")
		}
		return s.replacePeerManifest(peerID, connectionID, hello.Peer)
	case "command.result":
		if s.resolvePreview(peerID, connectionID, envelope.CommandID, data) {
			return nil
		}
		var result CommandResult
		if err := json.Unmarshal(data, &result); err != nil {
			return fmt.Errorf("decode bridge command result: %w", err)
		}
		s.resolve(peerID, connectionID, result.CommandID, commandReply{result: &result})
		return nil
	case "command.error":
		if s.resolvePreview(peerID, connectionID, envelope.CommandID, data) {
			return nil
		}
		var commandErr CommandError
		if err := json.Unmarshal(data, &commandErr); err != nil {
			return fmt.Errorf("decode bridge command error: %w", err)
		}
		s.resolve(peerID, connectionID, commandErr.CommandID, commandReply{err: &commandErr})
		return nil
	default:
		return nil
	}
}

func (s *Service) Dispatch(ctx context.Context, req DispatchRequest) (DispatchResponse, error) {
	if req.Command == preview.Command {
		return s.dispatchPreview(ctx, req)
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

func (s *Service) resolve(peerID, connectionID, commandID string, reply commandReply) {
	s.mu.Lock()
	state := s.peers[peerID]
	var ch chan commandReply
	if state != nil && (connectionID == "" || state.connectionID == connectionID) {
		if pending := state.pending[commandID]; pending != nil {
			ch = pending.reply
		}
	}
	s.mu.Unlock()
	if ch != nil {
		sendCommandReply(ch, reply)
	}
}

func sendCommandReply(ch chan commandReply, reply commandReply) {
	select {
	case ch <- reply:
	default:
	}
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
