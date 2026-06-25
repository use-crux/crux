package wire

import (
	"encoding/json"
	"fmt"
)

// ProjectIndexArtifactKind identifies JSON artifacts returned through the V2
// Project Index worker stream.
type ProjectIndexArtifactKind string

const (
	// ProjectIndexArtifactProjectModel is the source-discovery Project Model.
	ProjectIndexArtifactProjectModel ProjectIndexArtifactKind = "projectModel"
	// ProjectIndexArtifactProjectConfig is the effective config inspect model.
	ProjectIndexArtifactProjectConfig ProjectIndexArtifactKind = "projectConfig"
	// ProjectIndexArtifactNativeStaticConfig is the config-only native static planning input.
	ProjectIndexArtifactNativeStaticConfig ProjectIndexArtifactKind = "projectNativeStaticConfig"
	// ProjectIndexArtifactStaticSyntaxPlan is the native static parser plan.
	ProjectIndexArtifactStaticSyntaxPlan ProjectIndexArtifactKind = "projectStaticSyntaxPlan"
	// ProjectIndexArtifactStaticExtensionHostManifest is a data-only TS extension runtime manifest.
	ProjectIndexArtifactStaticExtensionHostManifest ProjectIndexArtifactKind = "staticExtensionHostManifest"
	// ProjectIndexArtifactStaticExtensionEvidenceBatch is a TS compatibility extractor result.
	ProjectIndexArtifactStaticExtensionEvidenceBatch ProjectIndexArtifactKind = "staticExtensionEvidenceBatch"
	// ProjectIndexArtifactStaticRuleCheck is a TS compatibility rule result.
	ProjectIndexArtifactStaticRuleCheck ProjectIndexArtifactKind = "staticRuleCheck"
)

// ProjectIndexArtifactStreamOptions configures host-side validation for a JSON
// artifact worker response.
type ProjectIndexArtifactStreamOptions struct {
	Root      string
	Artifact  ProjectIndexArtifactKind
	MaxBytes  int
	AllowRoot bool
}

// ProjectIndexArtifactStreamCollector validates one V2 artifact stream and
// exposes the payload only after a complete artifact:done event.
type ProjectIndexArtifactStreamCollector struct {
	options ProjectIndexArtifactStreamOptions
	payload json.RawMessage
	done    bool
	bytes   int
}

type projectIndexArtifactDoneEvent struct {
	ProtocolVersion int                      `json:"protocolVersion"`
	Type            string                   `json:"type"`
	TransactionID   string                   `json:"transactionId"`
	Artifact        ProjectIndexArtifactKind `json:"artifact"`
	Root            string                   `json:"root"`
	Payload         json.RawMessage          `json:"payload"`
}

// NewProjectIndexArtifactStreamCollector creates an empty collector for one
// artifact request stream.
func NewProjectIndexArtifactStreamCollector(options ProjectIndexArtifactStreamOptions) *ProjectIndexArtifactStreamCollector {
	return &ProjectIndexArtifactStreamCollector{options: options}
}

// Handle validates and records one raw NDJSON artifact worker event.
func (c *ProjectIndexArtifactStreamCollector) Handle(raw json.RawMessage) error {
	if c == nil {
		return fmt.Errorf("project index artifact stream collector is nil")
	}
	c.bytes += len(raw)
	if c.options.MaxBytes > 0 && c.bytes > c.options.MaxBytes {
		return fmt.Errorf("project index worker artifact stream exceeded byte budget: %d/%d", c.bytes, c.options.MaxBytes)
	}

	var header projectIndexWorkerEventHeader
	if err := json.Unmarshal(raw, &header); err != nil {
		return fmt.Errorf("decode project index worker artifact event header: %w", err)
	}
	if header.ProtocolVersion != projectIndexWorkerProtocolVersion {
		return fmt.Errorf("unsupported project index worker protocol version %d", header.ProtocolVersion)
	}
	if header.TransactionID == "" {
		return fmt.Errorf("project index worker artifact event missing transactionId")
	}

	switch header.Type {
	case "artifact:done":
		return c.handleArtifactDone(raw)
	case "artifact:error":
		return c.handleArtifactError(raw)
	default:
		return fmt.Errorf("unknown project index worker artifact event type %q", header.Type)
	}
}

// Payload returns the validated artifact payload.
func (c *ProjectIndexArtifactStreamCollector) Payload() (json.RawMessage, error) {
	if c == nil {
		return nil, fmt.Errorf("project index artifact stream collector is nil")
	}
	if !c.done {
		return nil, fmt.Errorf("project index worker artifact stream did not complete")
	}
	return append(json.RawMessage(nil), c.payload...), nil
}

func (c *ProjectIndexArtifactStreamCollector) handleArtifactDone(raw json.RawMessage) error {
	if c.done {
		return fmt.Errorf("project index worker artifact stream already completed")
	}
	var event projectIndexArtifactDoneEvent
	if err := json.Unmarshal(raw, &event); err != nil {
		return fmt.Errorf("decode artifact:done: %w", err)
	}
	if c.options.Artifact != "" && event.Artifact != c.options.Artifact {
		return fmt.Errorf("project index worker artifact = %s, want %s", event.Artifact, c.options.Artifact)
	}
	if err := c.validateRoot(event.Root); err != nil {
		return err
	}
	if len(event.Payload) == 0 {
		return fmt.Errorf("project index worker artifact %s missing payload", event.Artifact)
	}
	c.payload = append(json.RawMessage(nil), event.Payload...)
	c.done = true
	return nil
}

func (c *ProjectIndexArtifactStreamCollector) handleArtifactError(raw json.RawMessage) error {
	var event struct {
		Error struct {
			Message string `json:"message"`
			Code    string `json:"code,omitempty"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &event); err != nil {
		return fmt.Errorf("decode artifact:error: %w", err)
	}
	if event.Error.Message == "" {
		return fmt.Errorf("project index worker artifact failed")
	}
	return fmt.Errorf("project index worker artifact failed: %s", event.Error.Message)
}

func (c *ProjectIndexArtifactStreamCollector) validateRoot(root string) error {
	if c.options.Root == "" || c.options.AllowRoot {
		return nil
	}
	if root != c.options.Root {
		return fmt.Errorf("project index worker root = %s, want %s", root, c.options.Root)
	}
	return nil
}
