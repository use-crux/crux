package store

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

// PromptTextDiagnosticEvidence is compiler-owned evidence for one PromptText
// construction diagnostic. It is decoded strictly at the worker boundary so
// snapshots cannot retain a partially understood evidence variant.
type PromptTextDiagnosticEvidence struct {
	Kind               string                    `json:"kind"`
	SourceRefID        string                    `json:"sourceRefId"`
	InterpolationIndex int                       `json:"interpolationIndex"`
	InterpolationPath  []int                     `json:"interpolationPath,omitempty"`
	Proof              string                    `json:"proof"`
	Cause              PromptTextDiagnosticCause `json:"cause"`
}

// PromptTextDiagnosticCause is the flat Go carrier for the closed diagnostic
// cause union. Variant-specific fields are validated during JSON decoding.
type PromptTextDiagnosticCause struct {
	Kind              string   `json:"kind"`
	RuntimeKinds      []string `json:"runtimeKinds,omitempty"`
	MDJSONApplicable  bool     `json:"mdJsonApplicable,omitempty"`
	JoinableWithComma bool     `json:"joinableWithComma,omitempty"`
	Reason            string   `json:"reason,omitempty"`
}

// UnmarshalJSON rejects unknown, incomplete, noncanonical, or mixed-variant
// PromptText evidence before it enters the Project Index read model.
func (e *PromptTextDiagnosticEvidence) UnmarshalJSON(data []byte) error {
	var wire struct {
		Kind               string          `json:"kind"`
		SourceRefID        string          `json:"sourceRefId"`
		InterpolationIndex *int            `json:"interpolationIndex"`
		InterpolationPath  json.RawMessage `json:"interpolationPath"`
		Proof              string          `json:"proof"`
		Cause              json.RawMessage `json:"cause"`
	}
	if err := decodeStrictPromptTextJSON(data, &wire); err != nil {
		return fmt.Errorf("decode PromptText diagnostic evidence: %w", err)
	}
	if wire.Kind != "prompt-text" {
		return fmt.Errorf("PromptText diagnostic evidence kind = %q", wire.Kind)
	}
	if wire.SourceRefID == "" {
		return fmt.Errorf("PromptText diagnostic evidence missing sourceRefId")
	}
	if wire.InterpolationIndex == nil || !validPromptTextIndex(*wire.InterpolationIndex) {
		return fmt.Errorf("PromptText diagnostic evidence has invalid interpolationIndex")
	}
	if wire.Proof != "syntax-exact" && wire.Proof != "semantic-exact" {
		return fmt.Errorf("PromptText diagnostic evidence proof = %q", wire.Proof)
	}
	if len(wire.Cause) == 0 {
		return fmt.Errorf("PromptText diagnostic evidence missing cause")
	}
	cause, err := decodePromptTextDiagnosticCause(wire.Cause)
	if err != nil {
		return err
	}
	path := []int(nil)
	if len(wire.InterpolationPath) > 0 {
		if isPromptTextJSONNull(wire.InterpolationPath) {
			return fmt.Errorf("PromptText diagnostic evidence interpolationPath cannot be null")
		}
		if err := json.Unmarshal(wire.InterpolationPath, &path); err != nil {
			return fmt.Errorf("PromptText diagnostic evidence has invalid interpolationPath: %w", err)
		}
		if cause.Kind != "invalid-interpolation" || len(path) == 0 || len(path) > 64 {
			return fmt.Errorf("PromptText diagnostic evidence has invalid interpolationPath")
		}
		for _, index := range path {
			if !validPromptTextIndex(index) {
				return fmt.Errorf("PromptText diagnostic evidence has invalid interpolationPath")
			}
		}
	}
	*e = PromptTextDiagnosticEvidence{
		Kind:               wire.Kind,
		SourceRefID:        wire.SourceRefID,
		InterpolationIndex: *wire.InterpolationIndex,
		InterpolationPath:  path,
		Proof:              wire.Proof,
		Cause:              cause,
	}
	return nil
}

func decodePromptTextDiagnosticCause(data []byte) (PromptTextDiagnosticCause, error) {
	var wire struct {
		Kind              string          `json:"kind"`
		RuntimeKinds      json.RawMessage `json:"runtimeKinds"`
		MDJSONApplicable  json.RawMessage `json:"mdJsonApplicable"`
		JoinableWithComma json.RawMessage `json:"joinableWithComma"`
		Reason            json.RawMessage `json:"reason"`
	}
	if err := decodeStrictPromptTextJSON(data, &wire); err != nil {
		return PromptTextDiagnosticCause{}, fmt.Errorf("decode PromptText diagnostic cause: %w", err)
	}
	for name, raw := range map[string]json.RawMessage{
		"runtimeKinds":      wire.RuntimeKinds,
		"mdJsonApplicable":  wire.MDJSONApplicable,
		"joinableWithComma": wire.JoinableWithComma,
		"reason":            wire.Reason,
	} {
		if isPromptTextJSONNull(raw) {
			return PromptTextDiagnosticCause{}, fmt.Errorf(
				"PromptText diagnostic cause %s cannot be null",
				name,
			)
		}
	}
	runtimeKinds, hasRuntimeKinds, err := decodeOptionalPromptTextJSON[[]string](
		wire.RuntimeKinds,
		"runtimeKinds",
	)
	if err != nil {
		return PromptTextDiagnosticCause{}, err
	}
	mdJSONApplicable, hasMDJSONApplicable, err := decodeOptionalPromptTextJSON[bool](
		wire.MDJSONApplicable,
		"mdJsonApplicable",
	)
	if err != nil {
		return PromptTextDiagnosticCause{}, err
	}
	joinableWithComma, hasJoinableWithComma, err := decodeOptionalPromptTextJSON[bool](
		wire.JoinableWithComma,
		"joinableWithComma",
	)
	if err != nil {
		return PromptTextDiagnosticCause{}, err
	}
	reason, hasReason, err := decodeOptionalPromptTextJSON[string](
		wire.Reason,
		"reason",
	)
	if err != nil {
		return PromptTextDiagnosticCause{}, err
	}
	switch wire.Kind {
	case "invalid-interpolation":
		if !hasRuntimeKinds || !canonicalPromptTextRuntimeKinds(runtimeKinds) {
			return PromptTextDiagnosticCause{}, fmt.Errorf("PromptText diagnostic cause has invalid runtimeKinds")
		}
		if hasJoinableWithComma || hasReason ||
			(hasMDJSONApplicable && !mdJSONApplicable) {
			return PromptTextDiagnosticCause{}, fmt.Errorf("PromptText invalid-interpolation cause has foreign fields")
		}
		if hasMDJSONApplicable && !jsonApplicableRuntimeKinds(runtimeKinds) {
			return PromptTextDiagnosticCause{}, fmt.Errorf("PromptText diagnostic cause has invalid mdJsonApplicable")
		}
		return PromptTextDiagnosticCause{
			Kind:             wire.Kind,
			RuntimeKinds:     append([]string(nil), runtimeKinds...),
			MDJSONApplicable: hasMDJSONApplicable,
		}, nil
	case "inline-sequence":
		if hasRuntimeKinds || hasMDJSONApplicable || hasReason ||
			(hasJoinableWithComma && !joinableWithComma) {
			return PromptTextDiagnosticCause{}, fmt.Errorf("PromptText inline-sequence cause has foreign fields")
		}
		return PromptTextDiagnosticCause{
			Kind:              wire.Kind,
			JoinableWithComma: hasJoinableWithComma,
		}, nil
	case "json-serialization":
		if hasRuntimeKinds || hasMDJSONApplicable || hasJoinableWithComma ||
			!hasReason || reason != "undefined-result" {
			return PromptTextDiagnosticCause{}, fmt.Errorf("PromptText json-serialization cause has invalid fields")
		}
		return PromptTextDiagnosticCause{Kind: wire.Kind, Reason: reason}, nil
	default:
		return PromptTextDiagnosticCause{}, fmt.Errorf("PromptText diagnostic cause kind = %q", wire.Kind)
	}
}

func decodeOptionalPromptTextJSON[T any](
	raw json.RawMessage,
	name string,
) (T, bool, error) {
	var value T
	if len(raw) == 0 {
		return value, false, nil
	}
	if err := json.Unmarshal(raw, &value); err != nil {
		return value, false, fmt.Errorf(
			"PromptText diagnostic cause has invalid %s: %w",
			name,
			err,
		)
	}
	return value, true, nil
}

func isPromptTextJSONNull(raw json.RawMessage) bool {
	return len(raw) > 0 && bytes.Equal(bytes.TrimSpace(raw), []byte("null"))
}

func canonicalPromptTextRuntimeKinds(kinds []string) bool {
	order := []string{
		"non-finite-number", "boolean", "bigint", "symbol",
		"function", "object", "cyclic-array",
	}
	if len(kinds) == 0 || len(kinds) > len(order) {
		return false
	}
	position := -1
	for _, kind := range kinds {
		next := -1
		for index, candidate := range order {
			if kind == candidate {
				next = index
				break
			}
		}
		if next <= position {
			return false
		}
		position = next
	}
	return true
}

func jsonApplicableRuntimeKinds(kinds []string) bool {
	for _, kind := range kinds {
		if kind != "non-finite-number" && kind != "boolean" {
			return false
		}
	}
	return len(kinds) > 0
}

func validPromptTextIndex(value int) bool {
	return value >= 0 && value <= 1<<31-1
}

func decodeStrictPromptTextJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("expected one JSON value")
	}
	return nil
}
