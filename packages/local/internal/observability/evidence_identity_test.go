package observability

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestEvidenceIdentityV1SharedGolden(t *testing.T) {
	var fixture struct {
		Input struct {
			Subject               NodeRef  `json:"subject"`
			Source                NodeRef  `json:"source"`
			Role                  string   `json:"role"`
			EvidenceKind          string   `json:"evidenceKind"`
			IdempotencyKey        string   `json:"idempotencyKey"`
			Conclusion            string   `json:"conclusion"`
			ObservedAt            string   `json:"observedAt"`
			SupersedesEvidenceIDs []string `json:"supersedesEvidenceIds"`
		} `json:"input"`
		Expected struct {
			EvidenceID              string `json:"evidenceId"`
			ArtifactID              string `json:"artifactId"`
			ReferenceDigest         string `json:"referenceDigest"`
			AvailableDigest         string `json:"availableDigest"`
			CapturedReferenceDigest string `json:"capturedReferenceDigest"`
			NotCapturedDigest       string `json:"notCapturedDigest"`
			EmptySupersessionDigest string `json:"emptySupersessionDigest"`
			IntegerLikeKeyDigest    string `json:"integerLikeKeyDigest"`
			SeparatorDigest         string `json:"separatorDigest"`
			PolicyProcessedDigest   string `json:"policyProcessedDigest"`
			NumericBoundaryDigest   string `json:"numericBoundaryDigest"`
		} `json:"expected"`
		Inline struct {
			Available         any `json:"available"`
			IntegerLikeKeys   any `json:"integerLikeKeys"`
			Separators        any `json:"separators"`
			PolicyProcessed   any `json:"policyProcessed"`
			NumericBoundaries any `json:"numericBoundaries"`
			CapturedReference struct {
				Hash      string `json:"hash"`
				SizeBytes int64  `json:"sizeBytes"`
			} `json:"capturedReference"`
		} `json:"inline"`
		ExecutionIdentityCases []struct {
			Subject    NodeRef `json:"subject"`
			EvidenceID string  `json:"evidenceId"`
		} `json:"executionIdentityCases"`
	}
	raw := readCoreEvidenceFixture(t, "identity-v1.json")
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}

	evidenceID := deterministicEvidenceID(
		fixture.Input.Subject,
		fixture.Input.Role,
		fixture.Input.EvidenceKind,
		fixture.Input.IdempotencyKey,
	)
	if evidenceID != fixture.Expected.EvidenceID {
		t.Fatalf("evidence ID = %q, want %q", evidenceID, fixture.Expected.EvidenceID)
	}
	if got := deterministicEvidenceArtifactID(evidenceID); got != fixture.Expected.ArtifactID {
		t.Fatalf("artifact ID = %q, want %q", got, fixture.Expected.ArtifactID)
	}
	for _, testCase := range fixture.ExecutionIdentityCases {
		if got := deterministicEvidenceID(
			testCase.Subject,
			fixture.Input.Role,
			fixture.Input.EvidenceKind,
			fixture.Input.IdempotencyKey,
		); got != testCase.EvidenceID {
			t.Fatalf("%s evidence ID = %q, want %q", testCase.Subject.Kind, got, testCase.EvidenceID)
		}
	}

	supersedes := fixture.Input.SupersedesEvidenceIDs
	base := evidenceContentDigestInputV1{
		Subject:               fixture.Input.Subject,
		Role:                  fixture.Input.Role,
		EvidenceKind:          fixture.Input.EvidenceKind,
		Conclusion:            fixture.Input.Conclusion,
		ObservedAt:            fixture.Input.ObservedAt,
		SupersedesEvidenceIDs: supersedes,
	}
	cases := []struct {
		name       string
		sourceMode string
		source     any
		expected   string
	}{
		{
			name:       "reference",
			sourceMode: "reference",
			source:     evidenceReferenceDigestSource(fixture.Input.Source),
			expected:   fixture.Expected.ReferenceDigest,
		},
		{
			name:       "available",
			sourceMode: "inline",
			source: mustEvidenceInlineDigestSource(
				t,
				"available",
				fixture.Inline.Available,
				nil,
				nil,
			),
			expected: fixture.Expected.AvailableDigest,
		},
		{
			name:       "captured reference",
			sourceMode: "inline",
			source: mustEvidenceInlineDigestSource(
				t,
				"reference",
				nil,
				&fixture.Inline.CapturedReference.Hash,
				&fixture.Inline.CapturedReference.SizeBytes,
			),
			expected: fixture.Expected.CapturedReferenceDigest,
		},
		{
			name:       "not captured",
			sourceMode: "inline",
			source: mustEvidenceInlineDigestSource(
				t,
				"not-captured",
				nil,
				nil,
				nil,
			),
			expected: fixture.Expected.NotCapturedDigest,
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			input := base
			input.SourceMode = testCase.sourceMode
			input.Source = testCase.source
			got, err := evidenceContentDigestV1(input)
			if err != nil {
				t.Fatal(err)
			}
			if got != testCase.expected {
				t.Fatalf("digest = %q, want %q", got, testCase.expected)
			}
		})
	}

	edgeCases := []struct {
		name       string
		preview    any
		supersedes []string
		expected   string
	}{
		{
			name:       "empty supersession",
			preview:    fixture.Inline.Available,
			supersedes: []string{},
			expected:   fixture.Expected.EmptySupersessionDigest,
		},
		{
			name:       "integer-like preview keys",
			preview:    fixture.Inline.IntegerLikeKeys,
			supersedes: supersedes,
			expected:   fixture.Expected.IntegerLikeKeyDigest,
		},
		{
			name:       "literal and raw Unicode separators",
			preview:    fixture.Inline.Separators,
			supersedes: supersedes,
			expected:   fixture.Expected.SeparatorDigest,
		},
		{
			name:       "Core-policy-processed URL and media value",
			preview:    fixture.Inline.PolicyProcessed,
			supersedes: supersedes,
			expected:   fixture.Expected.PolicyProcessedDigest,
		},
		{
			name:       "JSON numeric boundaries",
			preview:    fixture.Inline.NumericBoundaries,
			supersedes: supersedes,
			expected:   fixture.Expected.NumericBoundaryDigest,
		},
	}
	for _, testCase := range edgeCases {
		t.Run(testCase.name, func(t *testing.T) {
			input := base
			input.SourceMode = "inline"
			input.SupersedesEvidenceIDs = testCase.supersedes
			input.Source = mustEvidenceInlineDigestSource(
				t,
				"available",
				testCase.preview,
				nil,
				nil,
			)
			got, err := evidenceContentDigestV1(input)
			if err != nil {
				t.Fatal(err)
			}
			if got != testCase.expected {
				t.Fatalf("digest = %q, want %q", got, testCase.expected)
			}
		})
	}

	if !reflect.DeepEqual(
		fixture.Input.SupersedesEvidenceIDs,
		[]string{"evidence_2222222222222222", "evidence_1111111111111111"},
	) {
		t.Fatal("fixture must exercise supersession normalization")
	}
}

func mustEvidenceInlineDigestSource(
	t *testing.T,
	captureState string,
	preview any,
	hash *string,
	sizeBytes *int64,
) map[string]any {
	t.Helper()
	source, err := evidenceInlineDigestSource(captureState, preview, hash, sizeBytes)
	if err != nil {
		t.Fatal(err)
	}
	return source
}
