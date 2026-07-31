package preview

import (
	"encoding/json"
)

type PreviewAdaptation struct {
	Contributor    string `json:"contributor"`
	Representation string `json:"representation"`
	State          string `json:"state"`
	FullTokens     *int   `json:"fullTokens,omitempty"`
	SelectedTokens *int   `json:"selectedTokens,omitempty"`
}

type PreviewWarning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type PreviewDiagnostic struct {
	ID          string `json:"id"`
	Code        string `json:"code"`
	Message     string `json:"message"`
	Contributor string `json:"contributor,omitempty"`
	Tokens      *int   `json:"tokens,omitempty"`
}

type RequestPreview struct {
	Status         string              `json:"status"`
	Model          string              `json:"model,omitempty"`
	InputTokens    *int                `json:"inputTokens,omitempty"`
	MaxInputTokens *int                `json:"maxInputTokens,omitempty"`
	Measurement    string              `json:"measurement"`
	Adaptations    []PreviewAdaptation `json:"adaptations"`
	Warnings       []PreviewWarning    `json:"warnings"`
	Diagnostics    []PreviewDiagnostic `json:"diagnostics"`
}

type PreviewContribution struct {
	ID              string   `json:"id"`
	Boundary        string   `json:"boundary"`
	Representations []string `json:"representations"`
}

type ReadyResult struct {
	Status            string                `json:"status"`
	TargetID          string                `json:"targetId"`
	CatalogueRevision uint64                `json:"catalogueRevision"`
	Preview           RequestPreview        `json:"preview"`
	Contributions     []PreviewContribution `json:"contributions"`
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
