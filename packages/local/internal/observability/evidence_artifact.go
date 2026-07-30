package observability

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

type evidenceSourceArtifactAttributes struct {
	EvidenceSource evidenceSourceArtifactMarker `json:"evidenceSource"`
}

type evidenceSourceArtifactMarker struct {
	EvidenceID   string `json:"evidenceId"`
	CaptureState string `json:"captureState"`
}

// validateEvidenceSourceArtifact recognizes the reserved, exact marker used
// by Core and validates the evidence-specific envelope before any generic
// artifact policy or persistence path may handle the record.
func validateEvidenceSourceArtifact(
	payload json.RawMessage,
	artifact ArtifactRecord,
) (bool, error) {
	if len(artifact.Attributes) == 0 {
		return false, nil
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(artifact.Attributes, &probe); err != nil {
		return false, fmt.Errorf("artifact attributes are invalid: %w", err)
	}
	if _, marked := probe["evidenceSource"]; !marked {
		return false, nil
	}

	decoder := json.NewDecoder(bytes.NewReader(artifact.Attributes))
	decoder.DisallowUnknownFields()
	var attributes evidenceSourceArtifactAttributes
	if err := decoder.Decode(&attributes); err != nil {
		return true, fmt.Errorf("evidence source marker is invalid: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return true, fmt.Errorf("evidence source marker contains trailing JSON")
	}
	if !evidenceIDPattern.MatchString(attributes.EvidenceSource.EvidenceID) {
		return true, fmt.Errorf("evidence source marker evidenceId is invalid")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(payload, &fields); err != nil {
		return true, fmt.Errorf("decode evidence source envelope: %w", err)
	}
	hasPreview := fields["preview"] != nil
	hasHash := fields["hash"] != nil
	hasSize := fields["sizeBytes"] != nil
	hasURI := fields["uri"] != nil
	if artifact.ContentType != "application/json" {
		return true, fmt.Errorf("evidence source contentType is invalid")
	}
	switch attributes.EvidenceSource.CaptureState {
	case "available":
		if artifact.Encoding != "json" || !hasPreview ||
			hasHash || hasSize || hasURI {
			return true, fmt.Errorf("available evidence source shape is invalid")
		}
		var preview any
		if err := json.Unmarshal(fields["preview"], &preview); err != nil {
			return true, fmt.Errorf(
				"evidence source preview is invalid JSON: %w",
				err,
			)
		}
	case "reference":
		if artifact.Encoding != "reference" || hasPreview || hasURI {
			return true, fmt.Errorf("reference evidence source shape is invalid")
		}
		if hasHash &&
			(isJSONNull(fields["hash"]) ||
				!contentDigestPattern.MatchString(artifact.Hash)) {
			return true, fmt.Errorf("reference evidence source hash is invalid")
		}
		if hasSize &&
			(isJSONNull(fields["sizeBytes"]) ||
				artifact.SizeBytes == nil ||
				*artifact.SizeBytes < 0) {
			return true, fmt.Errorf("reference evidence source size is invalid")
		}
	case "not-captured":
		if artifact.Encoding != "reference" ||
			hasPreview || hasHash || hasSize || hasURI {
			return true, fmt.Errorf(
				"not-captured evidence source shape is invalid",
			)
		}
	default:
		return true, fmt.Errorf("evidence source captureState is invalid")
	}
	return true, nil
}

func isEvidenceSourceArtifact(record Record) bool {
	if record.Type != RecordArtifact {
		return false
	}
	var artifact ArtifactRecord
	if err := json.Unmarshal(record.Payload, &artifact); err != nil {
		return false
	}
	marked, err := validateEvidenceSourceArtifact(record.Payload, artifact)
	return marked && err == nil
}

func parseEvidenceSourceArtifact(
	record Record,
) (ArtifactRecord, evidenceSourceArtifactMarker, bool, error) {
	if record.Type != RecordArtifact {
		return ArtifactRecord{}, evidenceSourceArtifactMarker{}, false, nil
	}
	var artifact ArtifactRecord
	if err := json.Unmarshal(record.Payload, &artifact); err != nil {
		return ArtifactRecord{}, evidenceSourceArtifactMarker{}, false, err
	}
	marked, err := validateEvidenceSourceArtifact(record.Payload, artifact)
	if err != nil || !marked {
		return artifact, evidenceSourceArtifactMarker{}, marked, err
	}
	var attributes evidenceSourceArtifactAttributes
	if err := json.Unmarshal(artifact.Attributes, &attributes); err != nil {
		return artifact, evidenceSourceArtifactMarker{}, true, err
	}
	return artifact, attributes.EvidenceSource, true, nil
}

func isJSONNull(raw json.RawMessage) bool {
	return bytes.Equal(bytes.TrimSpace(raw), []byte("null"))
}
