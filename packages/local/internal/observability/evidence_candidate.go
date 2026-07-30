package observability

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// evidenceCandidateV1 is the exact graph-invisible logical representation
// used for candidate identity and fixed-size admission.
type evidenceCandidateV1 struct {
	Version      int             `json:"version"`
	EvidenceID   string          `json:"evidenceId"`
	EvidenceKind string          `json:"evidenceKind"`
	CaptureState string          `json:"captureState"`
	Preview      json.RawMessage `json:"preview,omitempty"`
	Hash         *string         `json:"hash,omitempty"`
	SizeBytes    *int64          `json:"sizeBytes,omitempty"`
}

type evidenceCandidateMaterial struct {
	Candidate evidenceCandidateV1
	Canonical []byte
	Digest    string
}

func newEvidenceCandidateV1(
	artifact ArtifactRecord,
	marker evidenceSourceArtifactMarker,
) evidenceCandidateV1 {
	candidate := evidenceCandidateV1{
		Version:      evidenceCandidateDigestVersion,
		EvidenceID:   marker.EvidenceID,
		EvidenceKind: artifact.Kind,
		CaptureState: marker.CaptureState,
	}
	switch marker.CaptureState {
	case "available":
		candidate.Preview = append(json.RawMessage(nil), artifact.Preview...)
	case "reference":
		if artifact.Hash != "" {
			candidate.Hash = &artifact.Hash
		}
		if artifact.SizeBytes != nil {
			size := *artifact.SizeBytes
			candidate.SizeBytes = &size
		}
	}
	return candidate
}

func canonicalEvidenceCandidateV1(
	candidate evidenceCandidateV1,
) ([]byte, error) {
	if err := validateEvidenceCandidateV1(candidate); err != nil {
		return nil, err
	}
	canonical, err := canonicalEvidenceJSON(candidate)
	if err != nil {
		return nil, fmt.Errorf("canonicalize evidence candidate: %w", err)
	}
	return canonical, nil
}

func evidenceCandidateDigestV1(
	candidate evidenceCandidateV1,
) (string, error) {
	canonical, err := canonicalEvidenceCandidateV1(candidate)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canonical)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func materializeEvidenceCandidate(
	artifact ArtifactRecord,
	marker evidenceSourceArtifactMarker,
) (evidenceCandidateMaterial, error) {
	candidate := newEvidenceCandidateV1(artifact, marker)
	canonical, err := canonicalEvidenceCandidateV1(candidate)
	if err != nil {
		return evidenceCandidateMaterial{}, err
	}
	if len(canonical) > evidenceCandidateMaxBytes {
		return evidenceCandidateMaterial{}, evidenceStagingCandidateTooLarge()
	}
	sum := sha256.Sum256(canonical)
	return evidenceCandidateMaterial{
		Candidate: candidate,
		Canonical: canonical,
		Digest:    "sha256:" + hex.EncodeToString(sum[:]),
	}, nil
}

func validateEvidenceCandidateV1(candidate evidenceCandidateV1) error {
	if candidate.Version != evidenceCandidateDigestVersion {
		return fmt.Errorf("unsupported evidence candidate version")
	}
	if !evidenceIDPattern.MatchString(candidate.EvidenceID) {
		return fmt.Errorf("invalid evidence candidate evidenceId")
	}
	if !validEvidenceKind(candidate.EvidenceKind) {
		return fmt.Errorf("invalid evidence candidate kind")
	}
	switch candidate.CaptureState {
	case "available":
		if len(candidate.Preview) == 0 ||
			candidate.Hash != nil ||
			candidate.SizeBytes != nil {
			return fmt.Errorf("invalid available evidence candidate")
		}
	case "reference":
		if len(candidate.Preview) != 0 {
			return fmt.Errorf("invalid reference evidence candidate")
		}
		if candidate.Hash != nil &&
			!contentDigestPattern.MatchString(*candidate.Hash) {
			return fmt.Errorf("invalid reference evidence hash")
		}
		if candidate.SizeBytes != nil && *candidate.SizeBytes < 0 {
			return fmt.Errorf("invalid reference evidence size")
		}
	case "not-captured":
		if len(candidate.Preview) != 0 ||
			candidate.Hash != nil ||
			candidate.SizeBytes != nil {
			return fmt.Errorf("invalid not-captured evidence candidate")
		}
	default:
		return fmt.Errorf("invalid evidence candidate capture state")
	}
	return nil
}
