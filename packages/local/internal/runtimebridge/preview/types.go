// Package preview owns the strict, backend-neutral exact-prompt-preview wire.
package preview

import (
	"encoding/json"
	"errors"
)

const (
	Command               = "prompt.previewExact"
	DefaultDeadlineMS     = 15_000
	MaxDeadlineMS         = 30_000
	MaxRequestBytes       = 262_144
	MaxTargets            = 512
	MaxCapabilityBytes    = 1_048_576
	MaxSchemaBytes        = 65_536
	MaxResultStringBytes  = 1_048_576
	MaxResultSegments     = 10_000
	MaxResultBytes        = 2_097_152
	MaxDepth              = 32
	MaxNodes              = 10_000
	MaxKeys               = 5_000
	MaxKeyBytes           = 256
	MaxStringBytes        = 65_536
	MaxDecodedValueWeight = 131_072
	MaxSafeInteger        = uint64(9_007_199_254_740_991)
)

type InputDescriptor struct {
	Mode   string         `json:"mode"`
	Schema map[string]any `json:"schema,omitempty"`
}

type Target struct {
	DefinitionID string          `json:"definitionId"`
	Kind         string          `json:"kind"`
	Name         string          `json:"name"`
	Description  string          `json:"description,omitempty"`
	Input        InputDescriptor `json:"input"`
}

type Capability struct {
	Command           string   `json:"command"`
	CatalogueRevision uint64   `json:"catalogueRevision"`
	Targets           []Target `json:"targets"`
}

type Options struct {
	Provider    *string `json:"provider,omitempty"`
	ModelID     *string `json:"modelId,omitempty"`
	TokenBudget *int    `json:"tokenBudget,omitempty"`
}

type Payload struct {
	Input   map[string]any `json:"input"`
	Options *Options       `json:"options,omitempty"`
}

type Request struct {
	Type              string          `json:"type"`
	CommandID         string          `json:"commandId"`
	Command           string          `json:"command"`
	TargetID          string          `json:"targetId"`
	CatalogueRevision uint64          `json:"catalogueRevision"`
	Payload           json.RawMessage `json:"payload"`
	DeadlineMS        int             `json:"deadlineMs"`
}

type PeerChoice struct {
	PeerID      string `json:"peerId"`
	RuntimeName string `json:"runtimeName"`
	Environment string `json:"environment"`
}

type Failure struct {
	Code    string       `json:"code"`
	Message string       `json:"message"`
	Choices []PeerChoice `json:"choices,omitempty"`
}

func (e *Failure) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func IsFailure(err error, code string) bool {
	var failure *Failure
	return errors.As(err, &failure) && failure.Code == code
}

func NewFailure(code string) *Failure {
	return &Failure{Code: code, Message: failureMessages[code]}
}

var failureMessages = map[string]string{
	"invalid_request":         "The exact-preview request is invalid.",
	"no_peer":                 "No live runtime peer is available.",
	"environment_unavailable": "No live runtime peer matches the selected environment.",
	"capability_unavailable":  "No live runtime peer supports exact prompt preview.",
	"target_unavailable":      "No live runtime peer advertises this prompt target.",
	"catalogue_changed":       "The runtime prompt catalogue changed. Refresh and try again.",
	"ambiguous_peer":          "Multiple runtime peers can inspect this prompt. Select one and retry.",
	"peer_disconnected":       "The selected runtime peer disconnected.",
	"target_disappeared":      "The prompt target changed while preview was running. Refresh and try again.",
	"deadline_exceeded":       "Exact preview timed out.",
	"cancelled":               "Exact preview was cancelled.",
	"invalid_response":        "The runtime returned an invalid exact-preview response.",
	"command_failed":          "Exact preview failed in the application runtime.",
	"endpoint_not_allowed":    "The selected HTTP runtime endpoint is not allowed.",
}
