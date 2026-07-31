package observability

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	evidenceIDPattern      = regexp.MustCompile(`^evidence_[0-9a-f]{16,64}$`)
	idempotencyHashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
	contentDigestPattern   = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	evidenceSpanIDPattern  = regexp.MustCompile(`^[0-9a-f]{16}$`)
	evidenceRoles          = stringSetOf("intent", "authority", "change", "verification", "recovery")
	evidenceConclusions    = map[string]map[string]struct{}{
		"intent":       {},
		"authority":    stringSetOf("allowed", "denied", "revoked", "inconclusive"),
		"change":       stringSetOf("applied", "partial", "no-change", "unknown"),
		"verification": stringSetOf("passed", "failed", "inconclusive"),
		"recovery":     stringSetOf("available", "unavailable", "succeeded", "failed", "partial"),
	}
	evidenceCaptureStates = stringSetOf("available", "reference", "redacted", "not-captured")
)

type evidenceEdgeAttributes struct {
	EvidenceID            string            `json:"evidenceId"`
	Role                  string            `json:"role"`
	EvidenceKind          string            `json:"evidenceKind"`
	Conclusion            *string           `json:"conclusion,omitempty"`
	ObservedAt            *string           `json:"observedAt,omitempty"`
	RecordedAt            string            `json:"recordedAt"`
	Producer              *evidenceProducer `json:"producer"`
	SupersedesEvidenceIDs []string          `json:"supersedesEvidenceIds,omitempty"`
	CaptureState          *string           `json:"captureState,omitempty"`
	IdempotencyKeyHash    *string           `json:"idempotencyKeyHash,omitempty"`
	SourceMode            *string           `json:"sourceMode,omitempty"`
	ContentDigestVersion  *int              `json:"contentDigestVersion,omitempty"`
	ContentDigest         *string           `json:"contentDigest,omitempty"`
}

type evidenceProducer struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

func validateEvidenceEdgeAttributes(raw json.RawMessage) error {
	if len(raw) == 0 {
		return fmt.Errorf("evidence.for requires qualified attributes")
	}

	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var attributes evidenceEdgeAttributes
	if err := decoder.Decode(&attributes); err != nil {
		return fmt.Errorf("invalid evidence.for attributes: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("evidence.for attributes contain trailing JSON")
	}

	if _, roleValid := evidenceRoles[attributes.Role]; !roleValid {
		return fmt.Errorf("evidence.for role is invalid")
	}
	conclusions := evidenceConclusions[attributes.Role]
	if attributes.Conclusion != nil {
		if _, valid := conclusions[*attributes.Conclusion]; !valid {
			return fmt.Errorf("evidence.for conclusion does not match its role")
		}
	}
	if !evidenceIDPattern.MatchString(attributes.EvidenceID) {
		return fmt.Errorf("evidence.for evidenceId is invalid")
	}
	supersessionIDs := make(map[string]struct{}, len(attributes.SupersedesEvidenceIDs))
	for _, id := range attributes.SupersedesEvidenceIDs {
		if !evidenceIDPattern.MatchString(id) {
			return fmt.Errorf("evidence.for supersedesEvidenceIds is invalid")
		}
		if _, duplicate := supersessionIDs[id]; duplicate {
			return fmt.Errorf("evidence.for supersedesEvidenceIds contains a duplicate")
		}
		supersessionIDs[id] = struct{}{}
	}
	if !validEvidenceKind(attributes.EvidenceKind) {
		return fmt.Errorf("evidence.for evidenceKind is invalid")
	}
	if !validEvidenceTimestamp(attributes.RecordedAt) ||
		(attributes.ObservedAt != nil && !validEvidenceTimestamp(*attributes.ObservedAt)) {
		return fmt.Errorf("evidence.for timestamp is invalid")
	}
	if !validEvidenceProducer(attributes.Producer) {
		return fmt.Errorf("evidence.for producer is invalid")
	}
	if attributes.CaptureState != nil {
		if _, valid := evidenceCaptureStates[*attributes.CaptureState]; !valid {
			return fmt.Errorf("evidence.for captureState is invalid")
		}
	}
	if attributes.IdempotencyKeyHash != nil &&
		!idempotencyHashPattern.MatchString(*attributes.IdempotencyKeyHash) {
		return fmt.Errorf("evidence.for idempotencyKeyHash is invalid")
	}
	if attributes.CaptureState == nil {
		return fmt.Errorf("evidence.for captureState is required")
	}
	if attributes.SourceMode == nil {
		return fmt.Errorf("evidence.for sourceMode is required")
	}
	durableIdentityFields := 0
	if attributes.IdempotencyKeyHash != nil {
		durableIdentityFields++
	}
	if attributes.ContentDigestVersion != nil {
		durableIdentityFields++
	}
	if attributes.ContentDigest != nil {
		durableIdentityFields++
	}
	if durableIdentityFields != 0 && durableIdentityFields != 3 {
		return fmt.Errorf("evidence.for durable content identity is incomplete")
	}
	if attributes.SourceMode != nil &&
		*attributes.SourceMode != "inline" &&
		*attributes.SourceMode != "reference" {
		return fmt.Errorf("evidence.for sourceMode is invalid")
	}
	if attributes.SourceMode != nil &&
		*attributes.SourceMode == "reference" &&
		(attributes.CaptureState == nil || *attributes.CaptureState != "reference") {
		return fmt.Errorf("evidence.for reference sourceMode requires reference captureState")
	}
	if attributes.ContentDigestVersion != nil &&
		*attributes.ContentDigestVersion != 1 {
		return fmt.Errorf("evidence.for contentDigestVersion is invalid")
	}
	if attributes.ContentDigest != nil &&
		!contentDigestPattern.MatchString(*attributes.ContentDigest) {
		return fmt.Errorf("evidence.for contentDigest is invalid")
	}
	return nil
}

func validEvidenceProducer(producer *evidenceProducer) bool {
	if producer == nil || producer.ID == "" {
		return false
	}
	switch producer.Kind {
	case "run":
		return true
	case "span":
		return evidenceSpanIDPattern.MatchString(producer.ID) &&
			producer.ID != "0000000000000000"
	default:
		return false
	}
}

func validateEvidenceGraphNode(node NodeRef) error {
	switch node.Kind {
	case "run", "artifact":
		if node.ID != "" {
			return nil
		}
	case "span":
		if evidenceSpanIDPattern.MatchString(node.ID) &&
			node.ID != "0000000000000000" {
			return nil
		}
	}
	return fmt.Errorf("evidence.for graph node is invalid")
}

func validEvidenceKind(value string) bool {
	if _, canonical := canonicalArtifactKinds[value]; canonical {
		return true
	}
	return strings.HasPrefix(value, "custom.") &&
		value != "custom." &&
		!strings.HasPrefix(value, "custom.crux.") &&
		value == strings.TrimFunc(value, isECMAScriptWhitespace) &&
		!hasControlCharacter(value) &&
		utf8.RuneCountInString(value) <= 128
}

func validEvidenceTimestamp(value string) bool {
	if value == "" {
		return false
	}
	_, err := time.Parse(time.RFC3339Nano, value)
	return err == nil
}

func stringSetOf(values ...string) map[string]struct{} {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		set[value] = struct{}{}
	}
	return set
}
