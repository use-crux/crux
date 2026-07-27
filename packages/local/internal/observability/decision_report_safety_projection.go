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
	Source          string `json:"source"`
	Kind            string `json:"kind"`
	MessageIndex    *int   `json:"messageIndex,omitempty"`
	PartIndex       *int   `json:"partIndex,omitempty"`
	ToolName        string `json:"toolName,omitempty"`
	ToolCallID      string `json:"toolCallId,omitempty"`
	RetrieverID     string `json:"retrieverId,omitempty"`
	BlockIndex      *int   `json:"blockIndex,omitempty"`
	SegmentIndex    *int   `json:"segmentIndex,omitempty"`
	MemoryID        string `json:"memoryId,omitempty"`
	BoardID         string `json:"boardId,omitempty"`
	HandoffID       string `json:"handoffId,omitempty"`
	Attempt         *int   `json:"attempt,omitempty"`
	ContextID       string `json:"contextId,omitempty"`
	ToolSourceID    string `json:"sourceId,omitempty"`
	ToolSourceKind  string `json:"sourceKind,omitempty"`
	DescriptionKind string `json:"descriptionKind,omitempty"`
	SchemaDepth     *int   `json:"schemaDepth,omitempty"`
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
	case "model.input.tools":
		return "Model input · Tools"
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
	case source == "memory" && kind == "memory-context":
		memoryID := stringAttribute(attributes, "memoryId")
		if strings.TrimSpace(memoryID) == "" {
			return nil
		}
		origin := &TurnModelInputOrigin{Source: source, Kind: kind, MemoryID: memoryID}
		setBlockIndex(origin, attributes)
		return origin
	case source == "memory" && kind == "blackboard-context":
		boardID := stringAttribute(attributes, "boardId")
		if strings.TrimSpace(boardID) == "" {
			return nil
		}
		origin := &TurnModelInputOrigin{Source: source, Kind: kind, BoardID: boardID}
		setBlockIndex(origin, attributes)
		return origin
	case source == "handoff" && kind == "handoff-context":
		handoffID := stringAttribute(attributes, "handoffId")
		if strings.TrimSpace(handoffID) == "" {
			return nil
		}
		origin := &TurnModelInputOrigin{Source: source, Kind: kind, HandoffID: handoffID}
		setBlockIndex(origin, attributes)
		return origin
	case source == "feedback" && isFeedbackOriginKind(kind):
		attempt, ok := nonNegativeIntAttribute(attributes, "attempt")
		if !ok || attempt < 1 {
			return nil
		}
		return &TurnModelInputOrigin{Source: source, Kind: kind, Attempt: &attempt}
	case source == "instructions" && isInstructionOriginKind(kind):
		origin := &TurnModelInputOrigin{
			Source: source, Kind: kind, ContextID: stringAttribute(attributes, "contextId"),
		}
		setBlockIndex(origin, attributes)
		return origin
	case source == "tool-definition" && (kind == "authored" || kind == "discovered"):
		return toolDefinitionOrigin(attributes, kind)
	case source != "" && kind != "" && !isKnownInputSource(source):
		return &TurnModelInputOrigin{Source: source, Kind: kind}
	default:
		return nil
	}
}

func setBlockIndex(origin *TurnModelInputOrigin, attributes json.RawMessage) {
	if index, ok := nonNegativeIntAttribute(attributes, "blockIndex"); ok {
		origin.BlockIndex = &index
	}
}

func isFeedbackOriginKind(kind string) bool {
	return kind == "validation-feedback" || kind == "constraint-feedback" || kind == "rejected-output"
}

func isInstructionOriginKind(kind string) bool {
	return kind == "prompt" || kind == "context" || kind == "skill" || kind == "provider-adaptation"
}

func isKnownInputSource(source string) bool {
	switch source {
	case "user", "tool", "retrieval", "memory", "handoff", "feedback", "instructions", "tool-definition":
		return true
	default:
		return false
	}
}

func toolDefinitionOrigin(attributes json.RawMessage, kind string) *TurnModelInputOrigin {
	toolName := stringAttribute(attributes, "toolName")
	if strings.TrimSpace(toolName) == "" {
		return nil
	}
	origin := &TurnModelInputOrigin{Source: "tool-definition", Kind: kind, ToolName: toolName}
	if kind == "discovered" {
		origin.ToolSourceID = stringAttribute(attributes, "toolSourceId")
		origin.ToolSourceKind = stringAttribute(attributes, "toolSourceKind")
		if strings.TrimSpace(origin.ToolSourceID) == "" || strings.TrimSpace(origin.ToolSourceKind) == "" {
			return nil
		}
	}
	descriptionKind := stringAttribute(attributes, "descriptionKind")
	if descriptionKind == "tool" || descriptionKind == "schema" {
		origin.DescriptionKind = descriptionKind
		if depth, ok := nonNegativeIntAttribute(attributes, "schemaDepth"); ok {
			origin.SchemaDepth = &depth
		}
	}
	return origin
}
