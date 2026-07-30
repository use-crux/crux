package observability

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
)

const evidenceContentDigestVersion = 1

// evidenceContentDigestInputV1 is the destination-recomputable, post-policy
// relationship content. Envelope, producer, generated timestamps, and record
// identities are deliberately absent.
type evidenceContentDigestInputV1 struct {
	Subject               NodeRef  `json:"subject"`
	Role                  string   `json:"role"`
	EvidenceKind          string   `json:"evidenceKind"`
	SourceMode            string   `json:"sourceMode"`
	Conclusion            string   `json:"conclusion,omitempty"`
	ObservedAt            string   `json:"observedAt,omitempty"`
	SupersedesEvidenceIDs []string `json:"supersedesEvidenceIds"`
	Source                any      `json:"source"`
}

func deterministicEvidenceID(
	subject NodeRef,
	role string,
	evidenceKind string,
	rawKey string,
) string {
	subjectKind := subject.Kind
	if subjectKind == "run" || subjectKind == "span" {
		subjectKind = "execution"
	}
	return "evidence_" + evidenceSHA256(map[string]any{
		"subject":      subjectKind + ":" + subject.ID,
		"role":         role,
		"evidenceKind": evidenceKind,
		"key":          rawKey,
	})
}

func deterministicEvidenceArtifactID(evidenceID string) string {
	return "artifact_" + evidenceSHA256(map[string]any{
		"evidenceId": evidenceID,
	})
}

func evidenceContentDigestV1(input evidenceContentDigestInputV1) (string, error) {
	input.SupersedesEvidenceIDs = append([]string{}, input.SupersedesEvidenceIDs...)
	sort.Strings(input.SupersedesEvidenceIDs)
	canonical, err := canonicalEvidenceJSON(struct {
		Version int `json:"version"`
		evidenceContentDigestInputV1
	}{
		Version:                      evidenceContentDigestVersion,
		evidenceContentDigestInputV1: input,
	})
	if err != nil {
		return "", fmt.Errorf("canonicalize evidence content: %w", err)
	}
	sum := sha256.Sum256(canonical)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func recomputeEvidenceContentDigest(
	_ context.Context,
	_ *ingestStatements,
	edge EdgeRecord,
	attributes evidenceEdgeAttributes,
	sourceMode string,
) (string, bool, error) {
	if attributes.ContentDigest == nil {
		return "", false, nil
	}
	var source any
	switch sourceMode {
	case "reference":
		source = evidenceReferenceDigestSource(edge.From)
	case "inline":
		if attributes.CaptureState == nil {
			return "", false, evidenceConflict()
		}
		captureState := *attributes.CaptureState
		switch captureState {
		case "available", "reference":
			// Artifact-dependent evidence is verified only through the strict
			// marked-candidate path. An ordinary artifact with the same opaque
			// ID is not evidence and cannot satisfy this relationship.
			return "", false, nil
		default:
			var err error
			source, err = evidenceInlineDigestSource(
				captureState,
				nil,
				nil,
				nil,
			)
			if err != nil {
				return "", false, evidenceConflict()
			}
		}
	default:
		return "", false, evidenceConflict()
	}
	digest, err := evidenceContentDigestV1(evidenceContentDigestInputV1{
		Subject:               edge.To,
		Role:                  attributes.Role,
		EvidenceKind:          attributes.EvidenceKind,
		SourceMode:            sourceMode,
		Conclusion:            dereferenceString(attributes.Conclusion),
		ObservedAt:            dereferenceString(attributes.ObservedAt),
		SupersedesEvidenceIDs: attributes.SupersedesEvidenceIDs,
		Source:                source,
	})
	return digest, true, err
}

func evidenceCanonicalRecordDigest(record Record) (string, error) {
	canonical, err := canonicalEvidenceJSON(json.RawMessage(record.Payload))
	if err != nil {
		return "", fmt.Errorf("canonicalize evidence record: %w", err)
	}
	sum := sha256.Sum256(canonical)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func dereferenceString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func evidenceReferenceDigestSource(reference NodeRef) map[string]any {
	return map[string]any{"reference": reference}
}

func evidenceInlineDigestSource(
	captureState string,
	preview any,
	hash *string,
	sizeBytes *int64,
) (map[string]any, error) {
	source := map[string]any{"captureState": captureState}
	switch captureState {
	case "available":
		source["preview"] = preview
	case "reference":
		if hash != nil {
			source["hash"] = *hash
		}
		if sizeBytes != nil {
			source["sizeBytes"] = *sizeBytes
		}
	case "redacted", "not-captured":
	default:
		return nil, fmt.Errorf("unsupported evidence capture state %q", captureState)
	}
	return source, nil
}

func evidenceSHA256(value any) string {
	canonical, err := canonicalEvidenceJSON(value)
	if err != nil {
		panic(fmt.Sprintf("canonical evidence identity: %v", err))
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:])
}

// canonicalEvidenceJSON pins the shared TypeScript/Go encoding: recursively
// UTF-8-sorted keys, ECMAScript-compatible JSON numbers, unescaped HTML, and
// escaped Unicode line/paragraph separators.
func canonicalEvidenceJSON(value any) ([]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var normalized any
	if err := json.Unmarshal(raw, &normalized); err != nil {
		return nil, err
	}
	normalized = normalizeEvidenceJSONNumbers(normalized)

	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(normalized); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buffer.Bytes(), []byte("\n")), nil
}

func normalizeEvidenceJSONNumbers(value any) any {
	switch typed := value.(type) {
	case float64:
		if typed == 0 && math.Signbit(typed) {
			return float64(0)
		}
		return typed
	case []any:
		for index, entry := range typed {
			typed[index] = normalizeEvidenceJSONNumbers(entry)
		}
		return typed
	case map[string]any:
		for key, entry := range typed {
			typed[key] = normalizeEvidenceJSONNumbers(entry)
		}
		return typed
	default:
		return value
	}
}
