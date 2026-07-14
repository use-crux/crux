package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"

	"github.com/use-crux/crux/packages/local/internal/store"
)

type mcpRuntimeMetadata struct {
	InputSchema  json.RawMessage         `json:"inputSchema"`
	OutputSchema json.RawMessage         `json:"outputSchema,omitempty"`
	Facts        mcpRuntimeToolFacts     `json:"facts"`
	Discovery    mcpRuntimeDiscoveryInfo `json:"mcpDiscovery"`
}

type mcpRuntimeToolFacts struct {
	Kind     string                   `json:"kind"`
	ToolName string                   `json:"toolName"`
	MCP      mcpRuntimeToolProvenance `json:"mcp"`
}

type mcpRuntimeToolProvenance struct {
	ServerID    string `json:"serverId"`
	RemoteName  string `json:"remoteName"`
	ExposedName string `json:"exposedName"`
	Provenance  string `json:"provenance"`
}

type mcpRuntimeDiscoveryInfo struct {
	ObservedAt              string                 `json:"observedAt"`
	ToolListFingerprint     string                 `json:"toolListFingerprint"`
	InputSchemaFingerprint  string                 `json:"inputSchemaFingerprint"`
	OutputSchemaFingerprint string                 `json:"outputSchemaFingerprint,omitempty"`
	Annotations             *mcpRuntimeAnnotations `json:"annotations,omitempty"`
}

type mcpRuntimeAnnotations struct {
	Untrusted bool                    `json:"untrusted"`
	Value     mcpRuntimeAnnotationSet `json:"value"`
}

type mcpRuntimeAnnotationSet struct {
	Title           string `json:"title,omitempty"`
	ReadOnlyHint    *bool  `json:"readOnlyHint,omitempty"`
	DestructiveHint *bool  `json:"destructiveHint,omitempty"`
	IdempotentHint  *bool  `json:"idempotentHint,omitempty"`
	OpenWorldHint   *bool  `json:"openWorldHint,omitempty"`
}

func validateMCPRuntimeMetadata(
	definition store.ProjectDefinition,
	ownerServerID string,
	observedAt string,
	revision string,
) error {
	var metadata mcpRuntimeMetadata
	if len(definition.Metadata) == 0 || strictJSONDecode(definition.Metadata, &metadata) != nil {
		return fmt.Errorf("MCP runtime child %q has invalid metadata", definition.ID)
	}
	if !jsonObject(metadata.InputSchema) || (len(metadata.OutputSchema) != 0 && !jsonObject(metadata.OutputSchema)) {
		return fmt.Errorf("MCP runtime child %q has an invalid schema projection", definition.ID)
	}
	if metadata.Facts.Kind != "tool" || metadata.Facts.ToolName != definition.Name ||
		metadata.Facts.MCP.ExposedName != definition.Name || metadata.Facts.MCP.RemoteName == "" ||
		metadata.Facts.MCP.ServerID == "" || metadata.Facts.MCP.Provenance != "runtime-discovered" {
		return fmt.Errorf("MCP runtime child %q has inconsistent provenance", definition.ID)
	}
	if ownerServerID != "" && metadata.Facts.MCP.ServerID != ownerServerID {
		return fmt.Errorf("MCP runtime child %q does not belong to its authored server", definition.ID)
	}
	if metadata.Discovery.ObservedAt == "" || metadata.Discovery.ToolListFingerprint == "" ||
		metadata.Discovery.InputSchemaFingerprint == "" {
		return fmt.Errorf("MCP runtime child %q has incomplete discovery identity", definition.ID)
	}
	if metadata.Discovery.ObservedAt != observedAt || metadata.Discovery.ToolListFingerprint != revision {
		return fmt.Errorf("MCP runtime child %q contradicts its replacement identity", definition.ID)
	}
	if (len(metadata.OutputSchema) == 0) != (metadata.Discovery.OutputSchemaFingerprint == "") {
		return fmt.Errorf("MCP runtime child %q has inconsistent output schema identity", definition.ID)
	}
	if metadata.Discovery.Annotations != nil && !metadata.Discovery.Annotations.Untrusted {
		return fmt.Errorf("MCP runtime child %q annotations must remain marked untrusted", definition.ID)
	}
	return nil
}

func strictJSONDecode(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("unexpected trailing JSON")
	}
	return nil
}

func jsonObject(data []byte) bool {
	var object map[string]json.RawMessage
	return len(data) != 0 && json.Unmarshal(data, &object) == nil && object != nil
}

func compactMCPToolTombstone(definition store.ProjectDefinition) store.ProjectDefinition {
	var metadata mcpRuntimeMetadata
	if strictJSONDecode(definition.Metadata, &metadata) == nil {
		metadata.Discovery.Annotations = nil
		definition.Metadata, _ = json.Marshal(metadata)
	} else {
		definition.Metadata = nil
	}
	return store.ProjectDefinition{
		ID: definition.ID, Kind: "tool", Name: definition.Name,
		Fidelity: definition.Fidelity, Status: "removed",
		Fingerprint: definition.Fingerprint, Metadata: definition.Metadata,
	}
}
