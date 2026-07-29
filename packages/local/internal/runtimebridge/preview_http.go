package runtimebridge

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge/preview"
)

func (s *Service) revalidateHTTPPreview(
	ctx context.Context,
	selected selectedPreviewPeer,
	command CommandRequest,
) error {
	request, err := http.NewRequestWithContext(
		ctx, http.MethodGet, selected.peer.EndpointURL, nil,
	)
	if err != nil {
		return preview.NewFailure("invalid_request")
	}
	response, err := s.doPreviewHTTP(request)
	if err != nil {
		return contextOrPeerFailure(ctx, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return preview.NewFailure("target_disappeared")
	}
	decoder := json.NewDecoder(
		io.LimitReader(response.Body, preview.MaxCapabilityBytes+65_537),
	)
	var manifest struct {
		Enabled      bool              `json:"enabled"`
		Capabilities []json.RawMessage `json:"capabilities"`
	}
	if err := decoder.Decode(&manifest); err != nil || !manifest.Enabled {
		return preview.NewFailure("target_disappeared")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return preview.NewFailure("target_disappeared")
	}
	capability, err := previewCapabilityFromRaw(manifest.Capabilities)
	if err != nil || capability.CatalogueRevision != command.CatalogueRevision ||
		!previewTargetExists(capability, command.TargetID) {
		return preview.NewFailure("target_disappeared")
	}
	s.mu.Lock()
	currentErr := s.previewSelectionFailureLocked(selected, command)
	s.mu.Unlock()
	if currentErr != nil {
		return currentErr
	}
	return nil
}

func previewCapabilityFromRaw(values []json.RawMessage) (*preview.Capability, error) {
	var matches []json.RawMessage
	for _, value := range values {
		var discriminator struct {
			Command string `json:"command"`
		}
		if err := json.Unmarshal(value, &discriminator); err == nil &&
			discriminator.Command == preview.Command {
			matches = append(matches, value)
		}
	}
	if len(matches) != 1 {
		return nil, fmt.Errorf("invalid preview capability group")
	}
	return preview.DecodeCapability(matches[0])
}

func (s *Service) doPreviewHTTP(request *http.Request) (*http.Response, error) {
	client := *s.httpClient
	previous := client.CheckRedirect
	client.CheckRedirect = func(next *http.Request, via []*http.Request) error {
		if !IsLoopbackEndpoint(next.URL.String()) {
			return preview.NewFailure("endpoint_not_allowed")
		}
		if previous != nil {
			return previous(next, via)
		}
		return nil
	}
	return client.Do(request)
}
