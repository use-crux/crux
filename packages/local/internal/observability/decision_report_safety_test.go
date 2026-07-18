package observability

import (
	"encoding/json"
	"testing"
)

func TestMediaDecisionLocationPreservesEveryOriginVariant(t *testing.T) {
	tests := []struct {
		name       string
		attributes string
		assert     func(*testing.T, *TurnDecisionLocation)
	}{
		{
			name:       "message with zero indexes",
			attributes: `{"originKind":"message","messageIndex":0,"partIndex":0,"mediaPartType":"image"}`,
			assert: func(t *testing.T, location *TurnDecisionLocation) {
				if location.Origin.MessageIndex == nil || *location.Origin.MessageIndex != 0 {
					t.Fatalf("message index = %#v, want pointer to zero", location.Origin.MessageIndex)
				}
			},
		},
		{
			name:       "step",
			attributes: `{"originKind":"step","stepIndex":4,"partIndex":2,"mediaPartType":"file"}`,
			assert: func(t *testing.T, location *TurnDecisionLocation) {
				if location.Origin.StepIndex == nil || *location.Origin.StepIndex != 4 {
					t.Fatalf("step index = %#v, want pointer to four", location.Origin.StepIndex)
				}
			},
		},
		{
			name:       "operation",
			attributes: `{"originKind":"operation","operation":"generateSpeech","operationPhase":"output","field":"audio","partIndex":0,"mediaPartType":"audio"}`,
			assert: func(t *testing.T, location *TurnDecisionLocation) {
				origin := location.Origin
				if origin.Operation != "generateSpeech" || origin.Phase != "output" || origin.Field != "audio" {
					t.Fatalf("operation origin = %#v, want exact operation coordinates", origin)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			location := mediaDecisionLocation(json.RawMessage(test.attributes))
			if location == nil {
				t.Fatal("location = nil, want safe media coordinates")
			}
			if location.Origin.PartIndex < 0 || location.PartType == "" {
				t.Fatalf("location = %#v, want part index and type", location)
			}
			test.assert(t, location)
		})
	}
}

func TestMediaDecisionLocationRejectsIncompleteCoordinates(t *testing.T) {
	attributes := json.RawMessage(`{"originKind":"operation","operation":"generateImage","partIndex":0,"mediaPartType":"image"}`)
	if location := mediaDecisionLocation(attributes); location != nil {
		t.Fatalf("location = %#v, want incomplete origin omitted", location)
	}
}
