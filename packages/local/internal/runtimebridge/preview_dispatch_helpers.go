package runtimebridge

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge/preview"
)

func encodePreviewCommand(command CommandRequest) ([]byte, error) {
	return preview.MarshalRequestJSON(preview.Request{
		Type: command.Type, CommandID: command.CommandID,
		Command: command.Command, TargetID: command.TargetID,
		CatalogueRevision: command.CatalogueRevision,
		Payload:           command.Payload, DeadlineMS: command.DeadlineMS,
	})
}

func (s *Service) removePending(
	state *peerState,
	commandID string,
	pending *pendingCommand,
) {
	s.mu.Lock()
	if state.pending[commandID] == pending {
		delete(state.pending, commandID)
	}
	s.mu.Unlock()
}

func (s *Service) sendPreviewCancel(state *peerState, commandID, reason string) {
	data, _ := json.Marshal(map[string]string{
		"type": "command.cancel", "commandId": commandID, "reason": reason,
	})
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = state.send(ctx, data)
}

func (s *Service) publishPreviewFailure(peerID, commandID, code string) {
	s.publish(Event{
		Type: "runtime_bridge:event", Action: "command.failed",
		PeerID: peerID, CommandID: commandID, Code: code,
		Timestamp: time.Now().UTC(),
	})
}

func (s *Service) publishPreviewTerminal(peerID, commandID string, err error) {
	if err != nil {
		s.publishPreviewFailure(peerID, commandID, previewFailureCode(err))
		return
	}
	s.publish(Event{
		Type: "runtime_bridge:event", Action: "command.completed",
		PeerID: peerID, CommandID: commandID, Timestamp: time.Now().UTC(),
	})
}

func contextFailure(ctx context.Context) *preview.Failure {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return preview.NewFailure("deadline_exceeded")
	}
	return preview.NewFailure("cancelled")
}

func contextOrPeerFailure(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return contextFailure(ctx)
	}
	var failure *preview.Failure
	if errors.As(err, &failure) {
		return failure
	}
	return preview.NewFailure("peer_disconnected")
}

func cancelReason(ctx context.Context) string {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return "deadline-exceeded"
	}
	return "cancelled"
}

func previewFailureCode(err error) string {
	var failure *preview.Failure
	if errors.As(err, &failure) {
		return failure.Code
	}
	return "internal_error"
}
