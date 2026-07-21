package observability

import (
	"encoding/json"
	"strings"
)

// TurnSafetyDecision is the content-free Safety projection rendered by Runs Explain.
type TurnSafetyDecision struct {
	Target  TurnSafetyTarget      `json:"target"`
	Mode    string                `json:"mode"`
	Changed bool                  `json:"changed"`
	Origin  *TurnModelInputOrigin `json:"origin,omitempty"`
}

// TurnSafetyTarget identifies the canonical boundary without retaining its subject.
type TurnSafetyTarget struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// TurnModelInputOrigin carries only the stable coordinates allowed by ModelInputOrigin.
type TurnModelInputOrigin struct {
	Source       string `json:"source"`
	Kind         string `json:"kind"`
	MessageIndex *int   `json:"messageIndex,omitempty"`
	PartIndex    *int   `json:"partIndex,omitempty"`
	ToolName     string `json:"toolName,omitempty"`
	ToolCallID   string `json:"toolCallId,omitempty"`
	RetrieverID  string `json:"retrieverId,omitempty"`
	BlockIndex   *int   `json:"blockIndex,omitempty"`
	SegmentIndex *int   `json:"segmentIndex,omitempty"`
}

func safetyDecisionForAttributes(attributes json.RawMessage) *TurnSafetyDecision {
	boundary := stringAttribute(attributes, "boundary")
	mode := strings.ToLower(strings.TrimSpace(stringAttribute(attributes, "mode")))
	if strings.TrimSpace(boundary) == "" || (mode != "enforce" && mode != "report") {
		return nil
	}

	action := strings.ToLower(strings.TrimSpace(stringAttribute(attributes, "action")))
	return &TurnSafetyDecision{
		Target: TurnSafetyTarget{
			ID:    boundary,
			Label: safetyTargetLabel(boundary),
		},
		Mode:    mode,
		Changed: mode == "enforce" && safetyActionChangesContent(action),
		Origin:  modelInputOrigin(attributes),
	}
}

func safetyActionChangesContent(action string) bool {
	switch action {
	case "rewrite", "strip", "redact", "mask", "hash", "transform":
		return true
	default:
		return false
	}
}

func safetyTargetLabel(boundary string) string {
	switch boundary {
	case "model.input.text":
		return "Model input · Text"
	case "model.input.media":
		return "Model input · Media"
	case "model.instructions":
		return "Model instructions"
	default:
		return boundary
	}
}

func modelInputOrigin(attributes json.RawMessage) *TurnModelInputOrigin {
	source := stringAttribute(attributes, "inputSource")
	kind := stringAttribute(attributes, "inputOriginKind")
	switch {
	case source == "user" && (kind == "message" || kind == "prompt" || kind == "operation"):
		origin := &TurnModelInputOrigin{Source: source, Kind: kind}
		switch kind {
		case "message":
			if index, ok := nonNegativeIntAttribute(attributes, "messageIndex"); ok {
				origin.MessageIndex = &index
			}
			if index, ok := nonNegativeIntAttribute(attributes, "partIndex"); ok {
				origin.PartIndex = &index
			}
		case "operation":
			if index, ok := nonNegativeIntAttribute(attributes, "partIndex"); ok {
				origin.PartIndex = &index
			}
		}
		return origin
	case source == "tool" && kind == "tool-result":
		toolName := stringAttribute(attributes, "toolName")
		if strings.TrimSpace(toolName) == "" {
			return nil
		}
		origin := &TurnModelInputOrigin{
			Source:     source,
			Kind:       kind,
			ToolName:   toolName,
			ToolCallID: stringAttribute(attributes, "toolCallId"),
		}
		if index, ok := nonNegativeIntAttribute(attributes, "partIndex"); ok {
			origin.PartIndex = &index
		}
		return origin
	case source == "retrieval" && kind == "retrieval-context":
		retrieverID := stringAttribute(attributes, "retrieverId")
		if strings.TrimSpace(retrieverID) == "" {
			return nil
		}
		origin := &TurnModelInputOrigin{
			Source:      source,
			Kind:        kind,
			RetrieverID: retrieverID,
		}
		if index, ok := nonNegativeIntAttribute(attributes, "blockIndex"); ok {
			origin.BlockIndex = &index
		}
		if index, ok := nonNegativeIntAttribute(attributes, "segmentIndex"); ok {
			origin.SegmentIndex = &index
		}
		return origin
	case source != "" && kind != "" && source != "user" && source != "tool" && source != "retrieval":
		return &TurnModelInputOrigin{Source: source, Kind: kind}
	default:
		return nil
	}
}
