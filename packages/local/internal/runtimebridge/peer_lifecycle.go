package runtimebridge

import (
	"time"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge/preview"
)

// RegisterPeer installs one current peer while keeping preview metadata private.
func (s *Service) RegisterPeer(peer Peer, send Sender) Peer {
	registered, _ := s.RegisterPeerConnection(peer, send)
	return registered
}

// RegisterPeerConnection replaces a peer atomically and returns its private
// connection identity. An old socket cannot mutate or unregister a replacement.
func (s *Service) RegisterPeerConnection(peer Peer, send Sender) (Peer, string) {
	if peer.PeerID == "" {
		peer.PeerID = newID("peer")
	}
	if peer.RuntimeName == "" {
		peer.RuntimeName = "crux-runtime"
	}
	if peer.LastSeenAt.IsZero() {
		peer.LastSeenAt = time.Now().UTC()
	}
	normalizedPreview := normalizePreviewCapabilities(peer.Capabilities)
	if !preview.ValidPeerEnvironment(peer.Environment) ||
		(peer.Transport != TransportWS && peer.Transport != TransportHTTP) {
		normalizedPreview = nil
	}
	connectionID := newID("connection")
	s.mu.Lock()
	replaced := s.peers[peer.PeerID]
	s.peers[peer.PeerID] = &peerState{
		peer: peer, send: send, preview: normalizedPreview,
		connectionID:     connectionID,
		manifestRevision: 1, pending: map[string]*pendingCommand{},
	}
	s.bumpPreviewProjectionRevisionLocked()
	s.mu.Unlock()
	s.retirePeerState(replaced, true)
	s.Logger().Info("runtime bridge peer registered", "peerId", peer.PeerID, "transport", peer.Transport, "runtimeName", peer.RuntimeName, "endpointUrl", peer.EndpointURL)
	publicPeer := peerWithoutPreview(peer)
	s.publish(Event{
		Type: "runtime_bridge:event", Action: "peer.connected",
		PeerID: peer.PeerID, Peer: &publicPeer, Timestamp: time.Now().UTC(),
		PreviewProjectionRevision: s.PromptPreviewProjectionRevision(),
	})
	return publicPeer, connectionID
}

func (s *Service) UnregisterPeer(peerID string) {
	s.UnregisterPeerConnection(peerID, "")
}

// UnregisterPeerConnection removes only the connection that registered it.
func (s *Service) UnregisterPeerConnection(peerID, connectionID string) {
	s.mu.Lock()
	state, ok := s.peers[peerID]
	if ok && connectionID != "" && state.connectionID != connectionID {
		ok = false
	}
	if ok {
		delete(s.peers, peerID)
		s.bumpPreviewProjectionRevisionLocked()
	}
	s.mu.Unlock()
	if ok {
		s.retirePeerState(state, false)
		s.publish(Event{
			Type: "runtime_bridge:event", Action: "peer.disconnected",
			PeerID: peerID, Timestamp: time.Now().UTC(),
			PreviewProjectionRevision: s.PromptPreviewProjectionRevision(),
		})
	}
}

func (s *Service) Peers() []Peer {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Peer, 0, len(s.peers))
	for _, state := range s.peers {
		out = append(out, peerWithoutPreview(state.peer))
	}
	return out
}

func (s *Service) Touch(peerID string) {
	s.touchPeerConnection(peerID, "")
}

func (s *Service) touchPeerConnection(peerID, connectionID string) {
	s.mu.Lock()
	if state := s.peers[peerID]; state != nil &&
		(connectionID == "" || state.connectionID == connectionID) {
		state.peer.LastSeenAt = time.Now().UTC()
	}
	s.mu.Unlock()
}

func (s *Service) retirePeerState(state *peerState, replaced bool) {
	if state == nil {
		return
	}
	s.mu.Lock()
	pendingCommands := state.pending
	state.pending = map[string]*pendingCommand{}
	s.mu.Unlock()
	for commandID, pending := range pendingCommands {
		if !pending.preview {
			sendCommandReply(pending.reply, commandReply{localErr: ErrNoPeer})
			continue
		}
		code, reason := "peer_disconnected", "cancelled"
		if replaced {
			code, reason = "target_disappeared", "target-retired"
		}
		sendCommandReply(pending.reply, commandReply{
			localErr: preview.NewFailure(code),
		})
		if state.send != nil {
			s.sendPreviewCancel(state, commandID, reason)
		}
	}
}
