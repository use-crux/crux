package observability

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
)

type EffectRunAttributes struct {
	EffectID        string  `json:"crux.effect.id"`
	EffectVersion   int     `json:"crux.effect.version"`
	ReceiptID       string  `json:"crux.effect.receipt.id"`
	ScopeID         string  `json:"crux.effect.scope.id"`
	BoundaryID      string  `json:"crux.effect.boundary.id"`
	ParentReceiptID *string `json:"crux.effect.parent_receipt.id,omitempty"`
	Outcome         string  `json:"crux.effect.outcome"`
	Recovery        string  `json:"crux.effect.recovery"`
}

type EffectReceiptSummary struct {
	Kind            string          `json:"kind"`
	ReceiptID       string          `json:"receiptId"`
	EffectID        string          `json:"effectId"`
	EffectVersion   int             `json:"effectVersion"`
	ScopeID         string          `json:"scopeId"`
	BoundaryID      string          `json:"boundaryId"`
	ParentReceiptID *string         `json:"parentReceiptId,omitempty"`
	Outcome         string          `json:"outcome"`
	Recovery        string          `json:"recovery"`
	Resource        json.RawMessage `json:"resource,omitempty"`
}

type EffectResourceSummary struct {
	Type       string                     `json:"type"`
	ID         *string                    `json:"id,omitempty"`
	Namespace  *string                    `json:"namespace,omitempty"`
	Attributes map[string]json.RawMessage `json:"attributes,omitempty"`
}

var effectOutcomes = map[string]struct{}{
	"preparing": {},
	"running":   {},
	"succeeded": {},
	"failed":    {},
	"cancelled": {},
	"unknown":   {},
}

var terminalEffectOutcomes = map[string]struct{}{
	"succeeded": {},
	"failed":    {},
	"cancelled": {},
	"unknown":   {},
}

var effectRecoveryStates = map[string]struct{}{
	"available":           {},
	"unavailable":         {},
	"irreversible":        {},
	"expired":             {},
	"conflict":            {},
	"handler_unavailable": {},
	"ambiguous":           {},
	"recovered":           {},
}

func validateEffectRunAttributes(raw json.RawMessage) error {
	var attributes EffectRunAttributes
	if err := json.Unmarshal(raw, &attributes); err != nil {
		return fmt.Errorf("effect.run attributes: %w", err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return fmt.Errorf("effect.run attributes: %w", err)
	}
	for _, field := range []struct {
		name  string
		value string
	}{
		{"crux.effect.id", attributes.EffectID},
		{"crux.effect.receipt.id", attributes.ReceiptID},
		{"crux.effect.scope.id", attributes.ScopeID},
		{"crux.effect.boundary.id", attributes.BoundaryID},
	} {
		if _, ok := fields[field.name]; !ok || field.value == "" {
			return fmt.Errorf("effect.run attributes require non-empty %s", field.name)
		}
	}
	if attributes.EffectVersion <= 0 {
		return fmt.Errorf("effect.run attributes require positive crux.effect.version")
	}
	if rawParent, ok := fields["crux.effect.parent_receipt.id"]; ok {
		var parent string
		if err := json.Unmarshal(rawParent, &parent); err != nil || parent == "" {
			return fmt.Errorf("effect.run attributes require non-empty crux.effect.parent_receipt.id")
		}
	}
	if _, ok := effectOutcomes[attributes.Outcome]; !ok {
		return fmt.Errorf("effect.run attributes have invalid crux.effect.outcome %q", attributes.Outcome)
	}
	if _, ok := effectRecoveryStates[attributes.Recovery]; !ok {
		return fmt.Errorf("effect.run attributes have invalid crux.effect.recovery %q", attributes.Recovery)
	}
	return nil
}

func validateEffectReceiptArtifact(artifact ArtifactRecord) error {
	if artifact.Kind != "effect.receipt" {
		return nil
	}
	if artifact.ContentType != "application/json" || artifact.Encoding != "json" {
		return fmt.Errorf("effect receipt summaries must be inline JSON")
	}
	var summary EffectReceiptSummary
	if err := decodeStrictJSON(artifact.Preview, &summary); err != nil {
		return fmt.Errorf("effect receipt preview: %w", err)
	}
	for _, field := range []struct {
		name  string
		value string
	}{
		{"kind", summary.Kind},
		{"receiptId", summary.ReceiptID},
		{"effectId", summary.EffectID},
		{"scopeId", summary.ScopeID},
		{"boundaryId", summary.BoundaryID},
	} {
		if field.value == "" {
			return fmt.Errorf("effect receipt preview requires non-empty %s", field.name)
		}
	}
	if summary.Kind != "effect.receipt" {
		return fmt.Errorf("effect receipt preview kind = %q", summary.Kind)
	}
	if summary.EffectVersion <= 0 {
		return fmt.Errorf("effect receipt preview requires positive effectVersion")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(artifact.Preview, &fields); err != nil {
		return err
	}
	if err := validateOptionalNonEmptyString(fields, "parentReceiptId"); err != nil {
		return fmt.Errorf("effect receipt preview: %w", err)
	}
	if _, ok := terminalEffectOutcomes[summary.Outcome]; !ok {
		return fmt.Errorf("effect receipt preview has invalid outcome %q", summary.Outcome)
	}
	if _, ok := effectRecoveryStates[summary.Recovery]; !ok {
		return fmt.Errorf("effect receipt preview has invalid recovery %q", summary.Recovery)
	}
	if len(summary.Resource) > 0 {
		if err := validateEffectResource(summary.Resource); err != nil {
			return fmt.Errorf("effect receipt preview resource: %w", err)
		}
	}
	return nil
}

func validateEffectResource(raw json.RawMessage) error {
	raw = bytes.TrimSpace(raw)
	var resources []json.RawMessage
	if len(raw) > 0 && raw[0] == '[' {
		if err := json.Unmarshal(raw, &resources); err != nil {
			return err
		}
	} else {
		resources = []json.RawMessage{raw}
	}
	for _, rawResource := range resources {
		var resource EffectResourceSummary
		if err := decodeStrictJSON(rawResource, &resource); err != nil {
			return err
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(rawResource, &fields); err != nil {
			return err
		}
		if resource.Type == "" {
			return fmt.Errorf("requires non-empty type")
		}
		if err := validateOptionalNonEmptyString(fields, "id"); err != nil {
			return err
		}
		if err := validateOptionalNonEmptyString(fields, "namespace"); err != nil {
			return err
		}
		if rawAttributes, ok := fields["attributes"]; ok && bytes.Equal(bytes.TrimSpace(rawAttributes), []byte("null")) {
			return fmt.Errorf("attributes must be an object")
		}
		for name, rawValue := range resource.Attributes {
			var value any
			if err := json.Unmarshal(rawValue, &value); err != nil {
				return fmt.Errorf("attribute %q: %w", name, err)
			}
			switch typed := value.(type) {
			case string, bool:
			case float64:
				if math.IsInf(typed, 0) || math.IsNaN(typed) {
					return fmt.Errorf("attribute %q must be finite", name)
				}
			default:
				return fmt.Errorf("attribute %q must be a string, number, or boolean", name)
			}
		}
	}
	return nil
}

func validateOptionalNonEmptyString(fields map[string]json.RawMessage, name string) error {
	raw, ok := fields[name]
	if !ok {
		return nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil || value == "" {
		return fmt.Errorf("requires non-empty %s", name)
	}
	return nil
}

func validateRecoveryOfEdge(edge EdgeRecord) error {
	if edge.EdgeType != "recovery.of" {
		return nil
	}
	if edge.From.Kind != "span" || edge.To.Kind != "span" {
		return fmt.Errorf("recovery.of must connect span nodes")
	}
	return nil
}

func decodeStrictJSON(raw json.RawMessage, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return fmt.Errorf("contains trailing JSON")
		}
		return err
	}
	return nil
}
