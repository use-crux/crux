package observability

import (
	"encoding/json"
	"fmt"
	"testing"
)

func TestEvidenceCoverageEventRequiresStrictQualifiedAttributes(t *testing.T) {
	valid := `{"subject":{"kind":"span","id":"2222222222222222"},"role":"verification","status":"not-configured"}`
	if err := ValidateRecord(coverageEventRecord(t, "evidence.coverage", valid)); err != nil {
		t.Fatalf("valid evidence coverage event: %v", err)
	}

	for name, attributes := range map[string]string{
		"missing attributes":   "",
		"unsupported status":   `{"subject":{"kind":"span","id":"2222222222222222"},"role":"verification","status":"not-yet-recorded"}`,
		"effect receipt":       `{"subject":{"kind":"effect.receipt","id":"receipt","effectId":"effect"},"role":"change","status":"not-captured"}`,
		"on behalf producer":   `{"subject":{"kind":"span","id":"2222222222222222"},"role":"verification","status":"not-configured","producer":{"kind":"span","id":"3333333333333333"}}`,
		"duplicated timestamp": `{"subject":{"kind":"span","id":"2222222222222222"},"role":"verification","status":"not-configured","observedAt":"2026-07-28T12:00:00Z"}`,
	} {
		t.Run(name, func(t *testing.T) {
			if err := ValidateRecord(coverageEventRecord(t, "evidence.coverage", attributes)); err == nil {
				t.Fatal("invalid evidence coverage event passed validation")
			}
		})
	}

	if err := ValidateRecord(coverageEventRecord(
		t,
		"custom.future-event",
		`{"future":{"nested":true}}`,
	)); err != nil {
		t.Fatalf("unrelated future event lost forward compatibility: %v", err)
	}
}

func coverageEventRecord(t *testing.T, name string, attributes string) Record {
	t.Helper()
	attributesField := ""
	if attributes != "" {
		attributesField = `,"attributes":` + attributes
	}
	raw := fmt.Sprintf(
		`{"schemaVersion":5,"recordId":"rec_coverage","type":"span:event","operationId":"run_coverage","runId":"run_coverage","segmentId":"seg_coverage","segmentSeq":2,"spanId":"1111111111111111","eventId":"event_coverage","name":%q,"timestamp":"2026-07-28T12:00:00Z"%s}`,
		name,
		attributesField,
	)
	var record Record
	if err := json.Unmarshal([]byte(raw), &record); err != nil {
		t.Fatal(err)
	}
	return record
}
