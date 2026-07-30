package runtimebridge

import (
	"encoding/json"
	"time"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge/preview"
)

type Transport string

const (
	TransportWS   Transport = "ws"
	TransportHTTP Transport = "http"
)

type Capability struct {
	Command           string           `json:"command"`
	CatalogueRevision uint64           `json:"catalogueRevision,omitempty"`
	Targets           []preview.Target `json:"targets,omitempty"`
	Resources         []StoreResource  `json:"resources,omitempty"`
	raw               json.RawMessage
}

func (capability *Capability) UnmarshalJSON(data []byte) error {
	type wire Capability
	var decoded wire
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*capability = Capability(decoded)
	capability.raw = append(json.RawMessage(nil), data...)
	return nil
}

type StoreResource struct {
	Resource    string   `json:"resource"`
	Operations  []string `json:"operations"`
	Description string   `json:"description,omitempty"`
}

type Peer struct {
	PeerID       string            `json:"peerId"`
	RuntimeName  string            `json:"runtimeName"`
	Environment  string            `json:"environment"`
	Transport    Transport         `json:"transport"`
	EndpointURL  string            `json:"endpointUrl,omitempty"`
	Labels       map[string]string `json:"labels,omitempty"`
	Capabilities []Capability      `json:"capabilities"`
	LastSeenAt   time.Time         `json:"lastSeenAt"`
}

type RuntimeHello struct {
	Type string `json:"type"`
	Peer Peer   `json:"peer"`
}

type RuntimeHeartbeat struct {
	Type      string `json:"type"`
	PeerID    string `json:"peerId"`
	Timestamp string `json:"timestamp"`
}

type CommandRequest struct {
	Type              string          `json:"type"`
	CommandID         string          `json:"commandId"`
	Command           string          `json:"command"`
	TargetID          string          `json:"targetId,omitempty"`
	CatalogueRevision uint64          `json:"catalogueRevision,omitempty"`
	Payload           json.RawMessage `json:"payload,omitempty"`
	DeadlineMS        int             `json:"deadlineMs,omitempty"`
}

type CommandResult struct {
	Type      string          `json:"type"`
	CommandID string          `json:"commandId"`
	Result    json.RawMessage `json:"result,omitempty"`
	RunIDs    []string        `json:"runIds,omitempty"`
	TraceIDs  []string        `json:"traceIds,omitempty"`
}

type CommandError struct {
	Type      string           `json:"type"`
	CommandID string           `json:"commandId"`
	Error     CommandErrorBody `json:"error"`
}

type CommandErrorBody struct {
	Code    string          `json:"code"`
	Message string          `json:"message"`
	Details json.RawMessage `json:"details,omitempty"`
}

type CommandEnvelope struct {
	Type      string `json:"type"`
	CommandID string `json:"commandId,omitempty"`
}

type DispatchRequest struct {
	PeerID            string          `json:"peerId,omitempty"`
	Environment       string          `json:"environment,omitempty"`
	Command           string          `json:"command"`
	TargetID          string          `json:"targetId,omitempty"`
	CatalogueRevision uint64          `json:"catalogueRevision,omitempty"`
	Payload           json.RawMessage `json:"payload,omitempty"`
	DeadlineMS        int             `json:"deadlineMs,omitempty"`
}

type DispatchResponse struct {
	PeerID            string          `json:"peerId"`
	Result            json.RawMessage `json:"result,omitempty"`
	Error             *CommandError   `json:"error,omitempty"`
	RunIDs            []string        `json:"runIds,omitempty"`
	TraceIDs          []string        `json:"traceIds,omitempty"`
	RuntimeName       string          `json:"-"`
	PeerEnvironment   string          `json:"-"`
	CatalogueRevision uint64          `json:"-"`
}

type Event struct {
	Type                      string        `json:"type"`
	Action                    string        `json:"action"`
	PeerID                    string        `json:"peerId,omitempty"`
	CommandID                 string        `json:"commandId,omitempty"`
	Timestamp                 time.Time     `json:"timestamp"`
	Peer                      *Peer         `json:"peer,omitempty"`
	Error                     *CommandError `json:"error,omitempty"`
	Code                      string        `json:"code,omitempty"`
	PreviewProjectionRevision uint64        `json:"-"`
}
