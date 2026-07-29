package runtimebridge

import (
	"encoding/json"
	"time"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge/preview"
)

// ReplacePeerManifest atomically updates capabilities for one live connection.
func (s *Service) ReplacePeerManifest(peerID string, replacement Peer) error {
	return s.replacePeerManifest(peerID, "", replacement)
}

func (s *Service) replacePeerManifest(peerID, connectionID string, replacement Peer) error {
	s.mu.Lock()
	state := s.peers[peerID]
	if state == nil || (connectionID != "" && state.connectionID != connectionID) {
		s.mu.Unlock()
		return ErrNoPeer
	}
	replacement.PeerID = peerID
	replacement.LastSeenAt = time.Now().UTC()
	state.peer = replacement
	state.preview = normalizePreviewCapabilities(replacement.Capabilities)
	if !preview.ValidPeerEnvironment(replacement.Environment) ||
		(replacement.Transport != TransportWS && replacement.Transport != TransportHTTP) {
		state.preview = nil
	}
	state.manifestRevision++
	var retired []struct {
		commandID string
		pending   *pendingCommand
	}
	for commandID, pending := range state.pending {
		if !pending.preview {
			continue
		}
		delete(state.pending, commandID)
		retired = append(retired, struct {
			commandID string
			pending   *pendingCommand
		}{commandID: commandID, pending: pending})
	}
	s.mu.Unlock()
	for _, command := range retired {
		sendCommandReply(command.pending.reply, commandReply{
			localErr: preview.NewFailure("target_disappeared"),
		})
		if state.send != nil {
			s.sendPreviewCancel(state, command.commandID, "target-retired")
		}
	}
	return nil
}

func (s *Service) resolvePreview(peerID, connectionID, commandID string, data []byte) bool {
	s.mu.Lock()
	state := s.peers[peerID]
	var pending *pendingCommand
	if state != nil && (connectionID == "" || state.connectionID == connectionID) {
		pending = state.pending[commandID]
	}
	s.mu.Unlock()
	if pending == nil || !pending.preview {
		return false
	}
	decoded, err := preview.DecodeResponse(
		data, commandID, pending.targetID, pending.catalogueRevision,
	)
	if err != nil {
		s.resolve(peerID, connectionID, commandID, commandReply{localErr: err})
		return true
	}
	if decoded.Error != nil {
		s.resolve(peerID, connectionID, commandID, commandReply{
			localErr: preview.RuntimeFailure(decoded.Error),
		})
		return true
	}
	s.resolve(peerID, connectionID, commandID, commandReply{
		result: &CommandResult{
			Type: "command.result", CommandID: commandID, Result: decoded.Result,
		},
	})
	return true
}

func normalizePreviewCapabilities(capabilities []Capability) *preview.Capability {
	var matches []Capability
	for _, capability := range capabilities {
		if capability.Command == preview.Command {
			matches = append(matches, capability)
		}
	}
	if len(matches) != 1 {
		return nil
	}
	data := matches[0].raw
	if len(data) == 0 {
		data, _ = json.Marshal(matches[0])
	}
	normalized, err := preview.DecodeCapability(data)
	if err != nil {
		return nil
	}
	return normalized
}

func peerWithoutPreview(peer Peer) Peer {
	filtered := make([]Capability, 0, len(peer.Capabilities))
	for _, capability := range peer.Capabilities {
		if capability.Command != preview.Command {
			filtered = append(filtered, capability)
		}
	}
	peer.Capabilities = filtered
	return peer
}

func (s *Service) previewSelectionFailureLocked(
	selected selectedPreviewPeer,
	command CommandRequest,
) error {
	state := s.peers[selected.peer.PeerID]
	if state == nil {
		return preview.NewFailure("peer_disconnected")
	}
	if state != selected.state ||
		state.manifestRevision != selected.manifestRevision ||
		state.preview == nil ||
		state.preview.CatalogueRevision != command.CatalogueRevision ||
		!previewTargetExists(state.preview, command.TargetID) {
		return preview.NewFailure("target_disappeared")
	}
	return nil
}

func previewTargetExists(capability *preview.Capability, targetID string) bool {
	_, exists := findPreviewTarget(capability, targetID)
	return exists
}

func findPreviewTarget(
	capability *preview.Capability,
	targetID string,
) (preview.Target, bool) {
	if capability == nil {
		return preview.Target{}, false
	}
	for _, target := range capability.Targets {
		if target.DefinitionID == targetID {
			return target, true
		}
	}
	return preview.Target{}, false
}
