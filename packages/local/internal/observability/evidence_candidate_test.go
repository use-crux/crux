package observability

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestEvidenceCandidateV1SharedGolden(t *testing.T) {
	var fixture struct {
		Cases []struct {
			Name           string              `json:"name"`
			Candidate      evidenceCandidateV1 `json:"candidate"`
			ExpectedBytes  int                 `json:"expectedBytes"`
			ExpectedDigest string              `json:"expectedDigest"`
		} `json:"cases"`
		Boundary struct {
			Candidate             evidenceCandidateV1 `json:"candidate"`
			MaximumBytes          int                 `json:"maximumBytes"`
			AcceptedPaddingBytes  int                 `json:"acceptedPaddingBytes"`
			OversizedPaddingBytes int                 `json:"oversizedPaddingBytes"`
		} `json:"boundary"`
	}
	if err := json.Unmarshal(
		readCoreEvidenceFixture(t, "candidate-v1.json"),
		&fixture,
	); err != nil {
		t.Fatal(err)
	}

	for _, testCase := range fixture.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			canonical, err := canonicalEvidenceCandidateV1(testCase.Candidate)
			if err != nil {
				t.Fatal(err)
			}
			if len(canonical) != testCase.ExpectedBytes {
				t.Fatalf(
					"candidate bytes = %d, want %d",
					len(canonical),
					testCase.ExpectedBytes,
				)
			}
			digest, err := evidenceCandidateDigestV1(testCase.Candidate)
			if err != nil {
				t.Fatal(err)
			}
			if digest != testCase.ExpectedDigest {
				t.Fatalf("digest = %q, want %q", digest, testCase.ExpectedDigest)
			}
		})
	}

	for name, size := range map[string]int{
		"at limit":   fixture.Boundary.AcceptedPaddingBytes,
		"over limit": fixture.Boundary.OversizedPaddingBytes,
	} {
		t.Run(name, func(t *testing.T) {
			candidate := fixture.Boundary.Candidate
			candidate.Preview = json.RawMessage(
				`{"padding":"` + strings.Repeat("x", size) + `"}`,
			)
			canonical, err := canonicalEvidenceCandidateV1(candidate)
			if err != nil {
				t.Fatal(err)
			}
			want := fixture.Boundary.MaximumBytes
			if name == "over limit" {
				want++
			}
			if len(canonical) != want {
				t.Fatalf("candidate bytes = %d, want %d", len(canonical), want)
			}
		})
	}
}

func TestEvidenceCandidateV1DistinguishesPresence(t *testing.T) {
	base := evidenceCandidateV1{
		Version:      1,
		EvidenceID:   "evidence_1111111111111111",
		EvidenceKind: "score.report",
	}
	available := base
	available.CaptureState = "available"
	available.Preview = json.RawMessage("null")
	reference := base
	reference.CaptureState = "reference"
	zero := int64(0)
	reference.SizeBytes = &zero

	availableBytes, err := canonicalEvidenceCandidateV1(available)
	if err != nil {
		t.Fatal(err)
	}
	referenceBytes, err := canonicalEvidenceCandidateV1(reference)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(referenceBytes), `"preview"`) {
		t.Fatal("absent preview was serialized")
	}
	if !strings.Contains(string(availableBytes), `"preview":null`) {
		t.Fatal("explicit null preview was not serialized")
	}
	if !strings.Contains(string(referenceBytes), `"sizeBytes":0`) {
		t.Fatal("explicit zero size was not serialized")
	}
}

func TestEvidenceCandidateV1DefensivelyRejectsInvalidReferenceHashes(t *testing.T) {
	base := evidenceCandidateV1{
		Version:      1,
		EvidenceID:   "evidence_1111111111111111",
		EvidenceKind: "score.report",
		CaptureState: "reference",
	}
	for _, hash := range []string{
		"sha256:" + strings.Repeat("a", 63),
		"sha256:" + strings.Repeat("a", 65),
		"sha256:" + strings.Repeat("A", 64),
		"sha256:abc",
		"fnv1a:00000000",
		" sha256:" + strings.Repeat("a", 64),
		"sha256:" + strings.Repeat("a", 64) + " ",
		"sha256:" + strings.Repeat("a", 63) + "é",
	} {
		t.Run(hash, func(t *testing.T) {
			candidate := base
			candidate.Hash = &hash
			if _, err := canonicalEvidenceCandidateV1(candidate); err == nil {
				t.Fatal("expected invalid reference hash")
			}
		})
	}
	if _, err := canonicalEvidenceCandidateV1(base); err != nil {
		t.Fatalf("absent reference hash: %v", err)
	}
}

func TestEvidenceCandidateV1UsesCanonicalCustomKindGrammar(t *testing.T) {
	base := evidenceCandidateV1{
		Version:      1,
		EvidenceID:   "evidence_1111111111111111",
		CaptureState: "available",
		Preview:      json.RawMessage("null"),
	}
	for _, kind := range []string{
		"custom.crux.private",
		"custom.leading ",
		"custom.\u0001control",
		"custom." + strings.Repeat("x", 122),
	} {
		t.Run(kind, func(t *testing.T) {
			candidate := base
			candidate.EvidenceKind = kind
			if _, err := canonicalEvidenceCandidateV1(candidate); err == nil {
				t.Fatal("invalid custom kind reached durable candidate bytes")
			}
		})
	}
	for _, kind := range []string{
		"custom.a\u0085b",
		"custom.a\uFEFFb",
	} {
		t.Run(kind, func(t *testing.T) {
			candidate := base
			candidate.EvidenceKind = kind
			if _, err := canonicalEvidenceCandidateV1(candidate); err != nil {
				t.Fatalf("valid interior Unicode kind: %v", err)
			}
		})
	}
}
