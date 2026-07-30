package observability

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

const (
	approvalIDPrefix     = "approval_"
	maxApprovalIDScalars = 512
	maxApprovalIDBytes   = 2_048
)

type approvalArtifactAttributes struct {
	ApprovalOccurrence approvalArtifactOccurrence `json:"approvalOccurrence"`
}

type approvalArtifactOccurrence struct {
	Domain        string                    `json:"domain"`
	IdentityEpoch int                       `json:"identityEpoch"`
	Namespace     approvalArtifactNamespace `json:"namespace"`
	ApprovalID    string                    `json:"approvalId"`
	Slot          string                    `json:"slot"`
}

type approvalArtifactNamespace struct {
	OperationID string `json:"operationId"`
	RunID       string `json:"runId"`
}

// validateApprovalArtifact recognizes and validates the exact protected
// occurrence marker used by deterministic tool-approval artifacts.
func validateApprovalArtifact(artifact ArtifactRecord) (bool, error) {
	isApprovalKind := artifact.Kind == "approval.request" ||
		artifact.Kind == "approval.decision"
	hasMarker, err := hasApprovalOccurrenceMarker(artifact.Attributes)
	if err != nil {
		return isApprovalKind, err
	}
	if !isApprovalKind && !hasMarker {
		return false, nil
	}
	if !hasMarker {
		return true, fmt.Errorf("approval artifact marker is required")
	}
	attributes, err := decodeApprovalArtifactAttributes(artifact.Attributes)
	if err != nil {
		return true, err
	}
	occurrence := attributes.ApprovalOccurrence
	if occurrence.Domain != "crux.tool.approval" ||
		occurrence.IdentityEpoch != 1 ||
		!validApprovalID(occurrence.ApprovalID) {
		return true, fmt.Errorf("approval artifact occurrence is invalid")
	}
	expectedKind := "approval.request"
	if occurrence.Slot == "decision" {
		expectedKind = "approval.decision"
	} else if occurrence.Slot != "request" {
		return true, fmt.Errorf("approval artifact slot is invalid")
	}
	if artifact.Kind != expectedKind {
		return true, fmt.Errorf("approval artifact kind and slot do not match")
	}
	if occurrence.Namespace.OperationID == "" ||
		occurrence.Namespace.RunID == "" {
		return true, fmt.Errorf("approval artifact namespace is invalid")
	}
	if occurrence.Slot == "request" &&
		(occurrence.Namespace.OperationID != artifact.OperationID ||
			occurrence.Namespace.RunID != artifact.RunID) {
		return true, fmt.Errorf("approval request namespace does not match its envelope")
	}
	expectedID, err := approvalArtifactID(attributes)
	if err != nil {
		return true, err
	}
	if artifact.ArtifactID != expectedID {
		return true, fmt.Errorf("approval artifact id is invalid")
	}
	return true, nil
}

func decodeApprovalArtifactAttributes(
	raw json.RawMessage,
) (approvalArtifactAttributes, error) {
	if !utf8.Valid(raw) {
		return approvalArtifactAttributes{}, fmt.Errorf(
			"approval artifact marker is not valid UTF-8",
		)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var attributes approvalArtifactAttributes
	if err := decoder.Decode(&attributes); err != nil {
		return approvalArtifactAttributes{}, fmt.Errorf(
			"approval artifact marker is invalid: %w",
			err,
		)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return approvalArtifactAttributes{}, fmt.Errorf(
			"approval artifact marker contains trailing JSON",
		)
	}
	return attributes, nil
}

func hasApprovalOccurrenceMarker(raw json.RawMessage) (bool, error) {
	if len(raw) == 0 {
		return false, nil
	}
	if !utf8.Valid(raw) {
		return false, fmt.Errorf("artifact attributes are not valid UTF-8")
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return false, fmt.Errorf("artifact attributes are invalid: %w", err)
	}
	_, marked := probe["approvalOccurrence"]
	return marked, nil
}

func approvalArtifactID(attributes approvalArtifactAttributes) (string, error) {
	canonical, err := canonicalEvidenceJSON(attributes)
	if err != nil {
		return "", fmt.Errorf("canonical approval artifact identity: %w", err)
	}
	sum := sha256.Sum256(canonical)
	return "artifact_" + hex.EncodeToString(sum[:]), nil
}

func validApprovalID(value string) bool {
	if !utf8.ValidString(value) ||
		!strings.HasPrefix(value, approvalIDPrefix) ||
		len(value) > maxApprovalIDBytes ||
		utf8.RuneCountInString(value) > maxApprovalIDScalars {
		return false
	}
	suffix := strings.TrimPrefix(value, approvalIDPrefix)
	if suffix == "" {
		return false
	}
	first, _ := utf8.DecodeRuneInString(suffix)
	last, _ := utf8.DecodeLastRuneInString(suffix)
	if approvalBoundaryWhitespace(first) || approvalBoundaryWhitespace(last) {
		return false
	}
	for _, scalar := range suffix {
		if scalar <= 0x1f || (scalar >= 0x7f && scalar <= 0x9f) {
			return false
		}
	}
	return true
}

func approvalBoundaryWhitespace(value rune) bool {
	return (value >= 0x09 && value <= 0x0d) ||
		value == 0x20 ||
		value == 0x85 ||
		value == 0xa0 ||
		value == 0x1680 ||
		(value >= 0x2000 && value <= 0x200a) ||
		(value >= 0x2028 && value <= 0x2029) ||
		value == 0x202f ||
		value == 0x205f ||
		value == 0x3000 ||
		value == 0xfeff
}
