package resourceinspection

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
)

type RuntimeBridge interface {
	Peers() []runtimebridge.Peer
	Dispatch(context.Context, runtimebridge.DispatchRequest) (runtimebridge.DispatchResponse, error)
}

type Service struct {
	bridge RuntimeBridge
}

func New(bridge RuntimeBridge) *Service {
	return &Service{bridge: bridge}
}

func (s *Service) Capabilities(ctx context.Context) (Capabilities, error) {
	_ = ctx
	peers := s.storeReadPeers()
	resources := map[string]StoreResource{}
	for _, peer := range peers {
		for _, capability := range peer.Capabilities {
			if capability.Command != "store.read" {
				continue
			}
			for _, resource := range capability.Resources {
				resources[resource.Resource] = StoreResource{
					Resource:    resource.Resource,
					Operations:  append([]string(nil), resource.Operations...),
					Description: resource.Description,
					Kind:        inferredKind(resource.Resource),
				}
			}
		}
	}
	live := len(peers) > 0
	return Capabilities{
		LiveRuntime: LiveRuntimeCapabilities{
			Available: live,
			Commands:  commandList(live),
			Resources: sortedResources(resources),
		},
		Features: ResourceFeatures{
			MemoryInspect:     live,
			BlackboardInspect: live,
			LiveStoreRead:     live,
		},
	}, nil
}

func (s *Service) Get(ctx context.Context, req GetRequest) (ResourceResult, error) {
	if !supportsGet(req.ResourceID, req.Key) {
		return unavailable(req.ResourceID, inferredKind(req.ResourceID), ReasonUnsupportedResource, "This resource does not support direct get inspection."), nil
	}
	peer, result := s.selectStoreReadPeer(req.PeerID, req.ResourceID)
	if result != nil {
		return *result, nil
	}
	payload := map[string]any{
		"operation": "get",
		"resource":  req.ResourceID,
	}
	if req.Key != "" {
		payload["key"] = req.Key
	}
	return s.dispatchStoreRead(ctx, *peer, req.ResourceID, payload)
}

func (s *Service) List(ctx context.Context, req ListRequest) (ResourceResult, error) {
	if !supportsList(req.ResourceID) {
		return unavailable(req.ResourceID, inferredKind(req.ResourceID), ReasonUnsupportedResource, "This resource does not support list inspection."), nil
	}
	peer, result := s.selectStoreReadPeer(req.PeerID, req.ResourceID)
	if result != nil {
		return *result, nil
	}
	payload := map[string]any{
		"operation": "list",
		"resource":  req.ResourceID,
	}
	if req.Prefix != "" {
		payload["prefix"] = req.Prefix
	}
	if req.Cursor != "" {
		payload["cursor"] = req.Cursor
	}
	if req.Limit > 0 {
		payload["limit"] = req.Limit
	}
	return s.dispatchStoreRead(ctx, *peer, req.ResourceID, payload)
}

func (s *Service) selectStoreReadPeer(peerID string, resourceID string) (*runtimebridge.Peer, *ResourceResult) {
	peers := s.storeReadPeers()
	if peerID != "" {
		for _, peer := range peers {
			if peer.PeerID == peerID {
				return &peer, nil
			}
		}
		result := unavailable(resourceID, inferredKind(resourceID), ReasonRuntimeUnavailable, "The selected runtime bridge peer is not available for live resource inspection.")
		return nil, &result
	}
	if len(peers) == 0 {
		result := unavailable(resourceID, inferredKind(resourceID), ReasonBridgeRequired, "Enable Runtime Bridge to inspect live runtime-backed store data.")
		return nil, &result
	}
	if len(peers) > 1 {
		result := unavailable(resourceID, inferredKind(resourceID), ReasonAmbiguousPeer, "Multiple runtime bridge peers can inspect this resource. Select a runtime peer before retrying.")
		return nil, &result
	}
	return &peers[0], nil
}

func (s *Service) dispatchStoreRead(ctx context.Context, peer runtimebridge.Peer, resourceID string, payload map[string]any) (ResourceResult, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return ResourceResult{}, err
	}
	resp, err := s.bridge.Dispatch(ctx, runtimebridge.DispatchRequest{
		PeerID:  peer.PeerID,
		Command: "store.read",
		Payload: body,
	})
	if err != nil {
		if errors.Is(err, runtimebridge.ErrNoPeer) || errors.Is(err, runtimebridge.ErrNoCapability) {
			return unavailable(resourceID, inferredKind(resourceID), ReasonRuntimeUnavailable, "The live runtime bridge is not available for this resource."), nil
		}
		return errorResult(resourceID, ReasonCommandFailed, err.Error()), nil
	}
	if resp.Error != nil {
		return errorResult(resourceID, ReasonCommandFailed, resp.Error.Error.Message), nil
	}
	return normalizeBridgeResult(resourceID, resp.Result)
}

func normalizeBridgeResult(resourceID string, raw json.RawMessage) (ResourceResult, error) {
	var body struct {
		Value   json.RawMessage `json:"value"`
		Entries []struct {
			Key   string          `json:"key"`
			Value json.RawMessage `json:"value"`
		} `json:"entries"`
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &body); err != nil {
			return errorResult(resourceID, ReasonCommandFailed, fmt.Sprintf("Bridge returned an unreadable store.read result: %v", err)), nil
		}
	}
	entries := make([]ResourceEntry, 0, len(body.Entries))
	for _, entry := range body.Entries {
		entries = append(entries, ResourceEntry{Key: entry.Key, Value: entry.Value})
	}
	return ResourceResult{
		Status:     StatusOK,
		Source:     SourceRuntimeBridge,
		ResourceID: resourceID,
		Kind:       inferredKind(resourceID),
		Value:      body.Value,
		Entries:    entries,
	}, nil
}

func (s *Service) storeReadPeers() []runtimebridge.Peer {
	if s.bridge == nil {
		return nil
	}
	var out []runtimebridge.Peer
	for _, peer := range s.bridge.Peers() {
		for _, capability := range peer.Capabilities {
			if capability.Command == "store.read" {
				out = append(out, peer)
				break
			}
		}
	}
	return out
}

func supportsGet(resourceID, key string) bool {
	if strings.HasPrefix(resourceID, "blackboard:") {
		return true
	}
	if resourceID == "crux.store" && key != "" {
		return true
	}
	return false
}

func supportsList(resourceID string) bool {
	return resourceID == "crux.store" || strings.HasPrefix(resourceID, "memory:") || strings.HasPrefix(resourceID, "blackboard:")
}

func inferredKind(resourceID string) string {
	switch {
	case strings.HasPrefix(resourceID, "blackboard:"):
		return "blackboard"
	case strings.HasPrefix(resourceID, "memory:"):
		return "memory"
	case resourceID == "crux.store":
		return "store"
	default:
		return "resource"
	}
}

func commandList(live bool) []string {
	if !live {
		return nil
	}
	return []string{"store.read"}
}

func sortedResources(resources map[string]StoreResource) []StoreResource {
	out := make([]StoreResource, 0, len(resources))
	for _, resource := range resources {
		out = append(out, resource)
	}
	slices.SortFunc(out, func(a, b StoreResource) int {
		return strings.Compare(a.Resource, b.Resource)
	})
	return out
}

func unavailable(resourceID, kind, reason, message string) ResourceResult {
	return ResourceResult{
		Status:     StatusUnavailable,
		ResourceID: resourceID,
		Kind:       kind,
		Reason:     reason,
		Message:    message,
		DocsURL:    RuntimeBridgeDocsURL,
	}
}

func errorResult(resourceID, reason, message string) ResourceResult {
	return ResourceResult{
		Status:     StatusError,
		ResourceID: resourceID,
		Kind:       inferredKind(resourceID),
		Reason:     reason,
		Message:    message,
		DocsURL:    RuntimeBridgeDocsURL,
	}
}
