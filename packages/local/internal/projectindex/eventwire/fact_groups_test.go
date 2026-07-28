package eventwire

import (
	"encoding/json"
	"testing"
)

func TestDecodeFactGroupsDistinguishesOmittedEmptyAndNull(t *testing.T) {
	t.Parallel()

	omitted, err := DecodeFactGroups(nil)
	if err != nil {
		t.Fatalf("decode omitted factGroups: %v", err)
	}
	if omitted.Present || omitted.Value != nil {
		t.Fatalf("omitted factGroups = %#v, want absent nil", omitted)
	}

	empty, err := DecodeFactGroups(json.RawMessage(`[]`))
	if err != nil {
		t.Fatalf("decode empty factGroups: %v", err)
	}
	if !empty.Present || empty.Value == nil || len(empty.Value) != 0 {
		t.Fatalf("empty factGroups = %#v, want present nonnil empty", empty)
	}

	if _, err := DecodeFactGroups(json.RawMessage(`null`)); err == nil {
		t.Fatal("null factGroups decoded without error")
	}
}

func TestDecodeFactGroupsRequiresCanonicalKnownStringValues(t *testing.T) {
	t.Parallel()

	raw := json.RawMessage(`[
		"prompts","contexts","tools","lint","definitions","relations",
		"sourceRefs","diagnostics","lintFindings","ruleDescriptors","sources","sourceGraph"
	]`)
	decoded, err := DecodeFactGroups(raw)
	if err != nil {
		t.Fatalf("decode canonical factGroups: %v", err)
	}
	if !decoded.Present || len(decoded.Value) != len(canonicalIndexFactGroups) {
		t.Fatalf("canonical factGroups = %#v", decoded)
	}
	for index, want := range canonicalIndexFactGroups {
		if decoded.Value[index] != want {
			t.Fatalf("factGroups[%d] = %q, want %q", index, decoded.Value[index], want)
		}
	}

	for name, malformed := range map[string]string{
		"whitespace":   ` `,
		"object":       `{}`,
		"non-string":   `[1]`,
		"null-element": `[null]`,
		"unknown":      `["unknown"]`,
		"duplicate":    `["diagnostics","diagnostics"]`,
		"out-of-order": `["sources","diagnostics"]`,
		"trailing":     `[] true`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := DecodeFactGroups(json.RawMessage(malformed)); err == nil {
				t.Fatalf("DecodeFactGroups(%s) succeeded", malformed)
			}
		})
	}
}

func TestLegacyPhaseDoneSummaryIgnoresAdditiveFactGroups(t *testing.T) {
	t.Parallel()

	var legacy struct {
		FactCount int64 `json:"factCount"`
	}
	if err := json.Unmarshal(
		[]byte(`{"factCount":0,"factGroups":[]}`),
		&legacy,
	); err != nil {
		t.Fatalf("legacy summary rejected additive factGroups: %v", err)
	}
	if legacy.FactCount != 0 {
		t.Fatalf("legacy factCount = %d, want zero", legacy.FactCount)
	}
}
