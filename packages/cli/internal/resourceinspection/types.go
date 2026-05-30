package resourceinspection

import "encoding/json"

type Status string

const (
	StatusOK          Status = "ok"
	StatusPartial     Status = "partial"
	StatusUnavailable Status = "unavailable"
	StatusError       Status = "error"
)

type Source string

const (
	SourceProjection    Source = "projection"
	SourceRuntimeBridge Source = "runtime_bridge"
	SourceMixed         Source = "mixed"
)

const (
	ReasonBridgeRequired        = "bridge_required"
	ReasonRuntimeUnavailable    = "runtime_unavailable"
	ReasonUnsupportedResource   = "unsupported_resource"
	ReasonAmbiguousPeer         = "ambiguous_peer"
	ReasonCommandFailed         = "command_failed"
	ReasonProjectionUnavailable = "projection_unavailable"
)

const RuntimeBridgeDocsURL = "/docs/reference/crux-core/runtime-bridge"

type Capabilities struct {
	LiveRuntime LiveRuntimeCapabilities `json:"liveRuntime"`
	Features    ResourceFeatures        `json:"features"`
}

type LiveRuntimeCapabilities struct {
	Available bool            `json:"available"`
	Commands  []string        `json:"commands"`
	Resources []StoreResource `json:"resources"`
}

type StoreResource struct {
	Resource    string   `json:"resource"`
	Operations  []string `json:"operations"`
	Description string   `json:"description,omitempty"`
	Kind        string   `json:"kind,omitempty"`
}

type ResourceFeatures struct {
	MemoryInspect     bool `json:"memoryInspect"`
	BlackboardInspect bool `json:"blackboardInspect"`
	LiveStoreRead     bool `json:"liveStoreRead"`
}

type GetRequest struct {
	ResourceID string `json:"resourceId"`
	Key        string `json:"key,omitempty"`
	PeerID     string `json:"peerId,omitempty"`
}

type ListRequest struct {
	ResourceID string `json:"resourceId"`
	Prefix     string `json:"prefix,omitempty"`
	Cursor     string `json:"cursor,omitempty"`
	Limit      int    `json:"limit,omitempty"`
	PeerID     string `json:"peerId,omitempty"`
}

type ResourceResult struct {
	Status     Status          `json:"status"`
	Source     Source          `json:"source,omitempty"`
	ResourceID string          `json:"resourceId"`
	Kind       string          `json:"kind,omitempty"`
	Value      json.RawMessage `json:"value,omitempty"`
	Entries    []ResourceEntry `json:"entries,omitempty"`
	Message    string          `json:"message,omitempty"`
	Reason     string          `json:"reason,omitempty"`
	DocsURL    string          `json:"docsUrl,omitempty"`
}

type ResourceEntry struct {
	Key   string          `json:"key"`
	Value json.RawMessage `json:"value,omitempty"`
}
