package protocol

import "encoding/json"

const (
	// PromptTextProtocolVersion is the client-to-LSP decoration ABI version.
	PromptTextProtocolVersion uint16 = 1
)

// ExperimentalClientCapabilities contains Crux vendor capabilities. It is
// independent from standard LSP refresh capability namespaces.
type ExperimentalClientCapabilities struct {
	Crux *CruxClientCapabilities `json:"crux,omitempty"`
}

// UnmarshalJSON fails closed for malformed vendor capability shapes without
// rejecting the standard LSP initialize handshake.
func (c *ExperimentalClientCapabilities) UnmarshalJSON(data []byte) error {
	*c = ExperimentalClientCapabilities{}
	var experimental struct {
		Crux json.RawMessage `json:"crux"`
	}
	if json.Unmarshal(data, &experimental) != nil || len(experimental.Crux) == 0 {
		return nil
	}
	var crux struct {
		PromptText json.RawMessage `json:"promptText"`
	}
	if json.Unmarshal(experimental.Crux, &crux) != nil || len(crux.PromptText) == 0 {
		return nil
	}
	var promptText CruxPromptTextClientCapabilities
	if json.Unmarshal(crux.PromptText, &promptText) != nil {
		return nil
	}
	c.Crux = &CruxClientCapabilities{PromptText: &promptText}
	return nil
}

// CruxClientCapabilities groups client features owned by the Crux protocol.
type CruxClientCapabilities struct {
	PromptText *CruxPromptTextClientCapabilities `json:"promptText,omitempty"`
}

// CruxPromptTextClientCapabilities advertises client-owned PromptText hooks.
type CruxPromptTextClientCapabilities struct {
	RefreshSupport bool `json:"refreshSupport,omitempty"`
}

// PromptTextDecorationRole is the closed client presentation vocabulary.
type PromptTextDecorationRole string

const (
	PromptTextDecorationRoleHeading    PromptTextDecorationRole = "heading"
	PromptTextDecorationRoleLink       PromptTextDecorationRole = "link"
	PromptTextDecorationRoleCode       PromptTextDecorationRole = "code"
	PromptTextDecorationRoleEmphasis   PromptTextDecorationRole = "emphasis"
	PromptTextDecorationRoleStrong     PromptTextDecorationRole = "strong"
	PromptTextDecorationRoleList       PromptTextDecorationRole = "list"
	PromptTextDecorationRoleBlockquote PromptTextDecorationRole = "blockquote"
)

// PromptTextDecorationParams stamps one client pull with its exact buffer.
type PromptTextDecorationParams struct {
	ProtocolVersion uint16      `json:"protocolVersion"`
	URI             DocumentURI `json:"uri"`
	OpenEpoch       uint64      `json:"openEpoch"`
	Version         int64       `json:"version"`
	SourceHash      string      `json:"sourceHash"`
}

// PromptTextDecoration assigns one visual role to a UTF-16 source range.
type PromptTextDecoration struct {
	Role  PromptTextDecorationRole `json:"role"`
	Range Range                    `json:"range"`
}

// PromptTextDecorationResult echoes the request stamp. An explicit non-nil
// empty Decorations slice is the clear operation.
type PromptTextDecorationResult struct {
	ProtocolVersion uint16                 `json:"protocolVersion"`
	URI             DocumentURI            `json:"uri"`
	OpenEpoch       uint64                 `json:"openEpoch"`
	Version         int64                  `json:"version"`
	SourceHash      string                 `json:"sourceHash"`
	Decorations     []PromptTextDecoration `json:"decorations"`
}

// PromptTextRefreshParams versions the payload-free client invalidation.
type PromptTextRefreshParams struct {
	ProtocolVersion uint16 `json:"protocolVersion"`
}
