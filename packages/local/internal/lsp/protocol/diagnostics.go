package protocol

import (
	"encoding/json"
	"fmt"
	"strconv"
)

type Position struct {
	Line      uint32 `json:"line"`
	Character uint32 `json:"character"`
}

type Range struct {
	Start Position `json:"start"`
	End   Position `json:"end"`
}

type DiagnosticSeverity int

const (
	SeverityError       DiagnosticSeverity = 1
	SeverityWarning     DiagnosticSeverity = 2
	SeverityInformation DiagnosticSeverity = 3
	SeverityHint        DiagnosticSeverity = 4
)

type DiagnosticTag int

const (
	DiagnosticTagUnnecessary DiagnosticTag = 1
	DiagnosticTagDeprecated  DiagnosticTag = 2
)

// DiagnosticCode normalizes the LSP string-or-integer union to a string.
// Crux emits rule IDs as strings; integer codes from other diagnostic sources
// are accepted so mixed code-action contexts remain valid.
type DiagnosticCode string

// UnmarshalJSON accepts both code shapes allowed by the LSP specification.
func (code *DiagnosticCode) UnmarshalJSON(data []byte) error {
	var stringCode string
	if err := json.Unmarshal(data, &stringCode); err == nil {
		*code = DiagnosticCode(stringCode)
		return nil
	}

	var integerCode int64
	if err := json.Unmarshal(data, &integerCode); err != nil {
		return fmt.Errorf("diagnostic code must be a string or integer: %w", err)
	}
	*code = DiagnosticCode(strconv.FormatInt(integerCode, 10))
	return nil
}

type CodeDescription struct {
	Href DocumentURI `json:"href"`
}

type Location struct {
	URI   DocumentURI `json:"uri"`
	Range Range       `json:"range"`
}

type DiagnosticRelatedInformation struct {
	Location Location `json:"location"`
	Message  string   `json:"message"`
}

type Diagnostic struct {
	Range              Range                          `json:"range"`
	Severity           DiagnosticSeverity             `json:"severity,omitempty"`
	Code               DiagnosticCode                 `json:"code,omitempty"`
	CodeDescription    *CodeDescription               `json:"codeDescription,omitempty"`
	Source             string                         `json:"source,omitempty"`
	Message            string                         `json:"message"`
	Tags               []DiagnosticTag                `json:"tags,omitempty"`
	RelatedInformation []DiagnosticRelatedInformation `json:"relatedInformation,omitempty"`
	Data               json.RawMessage                `json:"data,omitempty"`
}

type PublishDiagnosticsParams struct {
	URI         DocumentURI  `json:"uri"`
	Version     *int         `json:"version,omitempty"`
	Diagnostics []Diagnostic `json:"diagnostics"`
}

// PublishDiagnosticsClientCapabilities declares support required for exact
// versioned PromptText diagnostics and their strict action locators.
type PublishDiagnosticsClientCapabilities struct {
	VersionSupport bool `json:"versionSupport,omitempty"`
	DataSupport    bool `json:"dataSupport,omitempty"`
}

type MessageType int

const (
	MessageTypeError   MessageType = 1
	MessageTypeWarning MessageType = 2
	MessageTypeInfo    MessageType = 3
	MessageTypeLog     MessageType = 4
)

type LogMessageParams struct {
	Type    MessageType `json:"type"`
	Message string      `json:"message"`
}
