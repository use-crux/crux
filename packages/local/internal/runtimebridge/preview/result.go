package preview

import (
	"encoding/json"
)

type Segment struct {
	Kind          string  `json:"kind"`
	StartUTF16    int     `json:"startUtf16"`
	EndUTF16      int     `json:"endUtf16"`
	Source        string  `json:"source,omitempty"`
	ObservedAt    *uint64 `json:"observedAt,omitempty"`
	SourceVersion string  `json:"sourceVersion,omitempty"`
}

type Part struct {
	Source        string    `json:"source"`
	Text          string    `json:"text"`
	Tokens        int       `json:"tokens"`
	Skipped       bool      `json:"skipped"`
	Segments      []Segment `json:"segments"`
	StaticTokens  *int      `json:"staticTokens,omitempty"`
	DynamicTokens *int      `json:"dynamicTokens,omitempty"`
}

type DroppedContext struct {
	Source   string    `json:"source"`
	Text     string    `json:"text"`
	Tokens   int       `json:"tokens"`
	Priority float64   `json:"priority"`
	Segments []Segment `json:"segments"`
}

type ExcludedContext struct {
	Source string `json:"source"`
	Reason string `json:"reason"`
}

type ReadyResult struct {
	Status            string `json:"status"`
	TargetID          string `json:"targetId"`
	CatalogueRevision uint64 `json:"catalogueRevision"`
	Inspection        struct {
		System struct {
			Text     string `json:"text"`
			Tokens   int    `json:"tokens"`
			Coverage string `json:"coverage"`
			Parts    []Part `json:"parts"`
		} `json:"system"`
		Prompt *struct {
			Text          string    `json:"text"`
			Tokens        int       `json:"tokens"`
			Segments      []Segment `json:"segments"`
			StaticTokens  *int      `json:"staticTokens,omitempty"`
			DynamicTokens *int      `json:"dynamicTokens,omitempty"`
		} `json:"prompt,omitempty"`
		TotalTokens      int               `json:"totalTokens"`
		DroppedContexts  []DroppedContext  `json:"droppedContexts"`
		ExcludedContexts []ExcludedContext `json:"excludedContexts"`
		TokenBudget      *int              `json:"tokenBudget,omitempty"`
		Tools            []string          `json:"tools,omitempty"`
	} `json:"inspection"`
}

type ValidationIssue struct {
	Code    string `json:"code"`
	Path    []any  `json:"path"`
	Message string `json:"message"`
}

type ValidationResult struct {
	Status            string            `json:"status"`
	TargetID          string            `json:"targetId"`
	CatalogueRevision uint64            `json:"catalogueRevision"`
	Issues            []ValidationIssue `json:"issues"`
	OmittedIssueCount int               `json:"omittedIssueCount"`
}

type ErrorDetails struct {
	TargetID                  string  `json:"targetId,omitempty"`
	ExpectedCatalogueRevision *uint64 `json:"expectedCatalogueRevision,omitempty"`
	ActualCatalogueRevision   *uint64 `json:"actualCatalogueRevision,omitempty"`
}

type ErrorBody struct {
	Code    string        `json:"code"`
	Message string        `json:"message"`
	Details *ErrorDetails `json:"details,omitempty"`
}

type DecodedResponse struct {
	Result json.RawMessage
	Error  *ErrorBody
}

// RuntimeFailure maps a valid application envelope onto Local's stable code.
func RuntimeFailure(value *ErrorBody) *Failure {
	if value == nil {
		return NewFailure("invalid_response")
	}
	switch value.Code {
	case "inspection_timeout":
		return NewFailure("deadline_exceeded")
	case "target_unavailable", "catalogue_changed", "target_retired":
		return NewFailure("target_disappeared")
	default:
		return NewFailure("command_failed")
	}
}

// DecodeResponse validates a terminal exact-preview envelope all-or-nothing.
func DecodeResponse(data []byte, commandID, targetID string, revision uint64) (DecodedResponse, error) {
	if len(data) > MaxResultBytes+2048 {
		return DecodedResponse{}, NewFailure("invalid_response")
	}
	if containsJSONNull(data) {
		return DecodedResponse{}, NewFailure("invalid_response")
	}
	var discriminator struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(data, &discriminator); err != nil {
		return DecodedResponse{}, NewFailure("invalid_response")
	}
	switch discriminator.Type {
	case "command.result":
		if !validResultOptionalStrings(data) {
			return DecodedResponse{}, NewFailure("invalid_response")
		}
		return decodeResultEnvelope(data, commandID, targetID, revision)
	case "command.error":
		if !validErrorOptionalStrings(data) {
			return DecodedResponse{}, NewFailure("invalid_response")
		}
		return decodeErrorEnvelope(data, commandID, targetID, revision)
	default:
		return DecodedResponse{}, NewFailure("invalid_response")
	}
}

func decodeResultEnvelope(data []byte, commandID, targetID string, revision uint64) (DecodedResponse, error) {
	var envelope struct {
		Type      string          `json:"type"`
		CommandID string          `json:"commandId"`
		Result    json.RawMessage `json:"result"`
	}
	if err := strictDecode(data, &envelope); err != nil || envelope.Type != "command.result" ||
		envelope.CommandID != commandID {
		return DecodedResponse{}, NewFailure("invalid_response")
	}
	resultBytes, compactErr := compactJSONBytes(envelope.Result)
	if compactErr != nil || resultBytes > MaxResultBytes {
		return DecodedResponse{}, NewFailure("invalid_response")
	}
	var status struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(envelope.Result, &status); err != nil {
		return DecodedResponse{}, NewFailure("invalid_response")
	}
	switch status.Status {
	case "ready":
		var result ReadyResult
		if err := strictDecode(envelope.Result, &result); err != nil ||
			validateReady(result, targetID, revision) != nil ||
			countStringBytes(envelope.Result) > MaxResultStringBytes {
			return DecodedResponse{}, NewFailure("invalid_response")
		}
	case "validation-error":
		var result ValidationResult
		if err := strictDecode(envelope.Result, &result); err != nil ||
			validateValidation(result, targetID, revision) != nil {
			return DecodedResponse{}, NewFailure("invalid_response")
		}
	default:
		return DecodedResponse{}, NewFailure("invalid_response")
	}
	return DecodedResponse{Result: clone(envelope.Result)}, nil
}

func decodeErrorEnvelope(
	data []byte,
	commandID, targetID string,
	revision uint64,
) (DecodedResponse, error) {
	var envelope struct {
		Type      string    `json:"type"`
		CommandID string    `json:"commandId"`
		Error     ErrorBody `json:"error"`
	}
	if err := strictDecode(data, &envelope); err != nil ||
		envelope.Type != "command.error" || envelope.CommandID != commandID ||
		!validRuntimeError(envelope.Error, targetID, revision) {
		return DecodedResponse{}, NewFailure("invalid_response")
	}
	return DecodedResponse{Error: &envelope.Error}, nil
}

func validRuntimeError(value ErrorBody, targetID string, revision uint64) bool {
	switch value.Code {
	case "invalid_request", "target_unavailable", "catalogue_changed",
		"target_retired", "input_limit_exceeded", "inspection_timeout",
		"inspection_failed", "result_limit_exceeded", "internal_error":
	default:
		return false
	}
	if value.Message == "" || utf16Length(value.Message) > 1024 {
		return false
	}
	if value.Details == nil {
		return true
	}
	if value.Details.TargetID != "" && value.Details.TargetID != targetID {
		return false
	}
	if expected := value.Details.ExpectedCatalogueRevision; expected != nil &&
		*expected != revision {
		return false
	}
	if actual := value.Details.ActualCatalogueRevision; actual != nil &&
		(*actual == 0 || *actual > MaxSafeInteger) {
		return false
	}
	return true
}

func validResultOptionalStrings(data []byte) bool {
	var value any
	if json.Unmarshal(data, &value) != nil {
		return false
	}
	var visit func(any) bool
	visit = func(candidate any) bool {
		switch typed := candidate.(type) {
		case []any:
			for _, child := range typed {
				if !visit(child) {
					return false
				}
			}
		case map[string]any:
			if _, isSegment := typed["startUtf16"]; isSegment {
				for _, field := range []string{"source", "sourceVersion"} {
					if value, present := typed[field]; present {
						text, ok := value.(string)
						if !ok || text == "" {
							return false
						}
					}
				}
			}
			for _, child := range typed {
				if !visit(child) {
					return false
				}
			}
		}
		return true
	}
	return visit(value)
}

func validErrorOptionalStrings(data []byte) bool {
	var envelope struct {
		Error struct {
			Details map[string]json.RawMessage `json:"details"`
		} `json:"error"`
	}
	if json.Unmarshal(data, &envelope) != nil || envelope.Error.Details == nil {
		return true
	}
	target, present := envelope.Error.Details["targetId"]
	if !present {
		return true
	}
	var value string
	return json.Unmarshal(target, &value) == nil && value != ""
}

func clone(raw json.RawMessage) json.RawMessage {
	return append(json.RawMessage(nil), raw...)
}
