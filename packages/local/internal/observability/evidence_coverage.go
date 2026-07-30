package observability

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

var evidenceCoverageStatuses = stringSetOf(
	"not-configured",
	"not-applicable",
	"not-captured",
	"redacted",
)

type evidenceCoverageEventAttributes struct {
	Subject NodeRef `json:"subject"`
	Role    string  `json:"role"`
	Status  string  `json:"status"`
}

type evidenceCoverageConflictAttributes struct {
	Role string `json:"role"`
}

func validateQualifiedEvidenceEvent(record Record) error {
	var event struct {
		Name       string          `json:"name"`
		Attributes json.RawMessage `json:"attributes"`
	}
	if err := json.Unmarshal(record.Payload, &event); err != nil {
		return err
	}
	switch event.Name {
	case "evidence.coverage":
		return validateEvidenceCoverageAttributes(event.Attributes)
	case "evidence.coverage.conflict":
		return validateEvidenceCoverageConflictAttributes(event.Attributes)
	default:
		return nil
	}
}

func validateEvidenceCoverageAttributes(raw json.RawMessage) error {
	var attributes evidenceCoverageEventAttributes
	if err := decodeStrictEvidenceEventAttributes(raw, &attributes); err != nil {
		return fmt.Errorf("invalid evidence.coverage attributes: %w", err)
	}
	if !validEvidenceCoverageSubject(attributes.Subject) {
		return fmt.Errorf("evidence.coverage subject is invalid")
	}
	if _, valid := evidenceRoles[attributes.Role]; !valid {
		return fmt.Errorf("evidence.coverage role is invalid")
	}
	if _, valid := evidenceCoverageStatuses[attributes.Status]; !valid {
		return fmt.Errorf("evidence.coverage status is invalid")
	}
	return nil
}

func validateEvidenceCoverageConflictAttributes(raw json.RawMessage) error {
	var attributes evidenceCoverageConflictAttributes
	if err := decodeStrictEvidenceEventAttributes(raw, &attributes); err != nil {
		return fmt.Errorf("invalid evidence.coverage.conflict attributes: %w", err)
	}
	if _, valid := evidenceRoles[attributes.Role]; !valid {
		return fmt.Errorf("evidence.coverage.conflict role is invalid")
	}
	return nil
}

func decodeStrictEvidenceEventAttributes(raw json.RawMessage, destination any) error {
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return fmt.Errorf("qualified attributes are required")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("attributes contain trailing JSON")
	}
	return nil
}

func validEvidenceCoverageSubject(subject NodeRef) bool {
	if subject.ID == "" {
		return false
	}
	switch subject.Kind {
	case "run", "artifact":
		return true
	case "span":
		return evidenceSpanIDPattern.MatchString(subject.ID) &&
			subject.ID != "0000000000000000"
	default:
		return false
	}
}
