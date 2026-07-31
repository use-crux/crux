package observability

import "testing"

func TestEvidenceStagingV1Bounds(t *testing.T) {
	if evidenceCandidateMaxBytes != 512*1024 {
		t.Fatalf("candidate bytes = %d", evidenceCandidateMaxBytes)
	}
	if evidenceCandidatesPerEvidence != 4 {
		t.Fatalf("per-evidence rows = %d", evidenceCandidatesPerEvidence)
	}
	if evidenceCandidatesPerNamespace != 512 {
		t.Fatalf("per-namespace rows = %d", evidenceCandidatesPerNamespace)
	}
	if evidenceCandidateBytesPerNamespace != 16*1024*1024 {
		t.Fatalf(
			"per-namespace bytes = %d",
			evidenceCandidateBytesPerNamespace,
		)
	}
	if evidenceCandidatesPerProject != 2_000 {
		t.Fatalf("project rows = %d", evidenceCandidatesPerProject)
	}
	if evidenceCandidateBytesPerProject != 64*1024*1024 {
		t.Fatalf("project bytes = %d", evidenceCandidateBytesPerProject)
	}
}

func TestEvidenceStagingDispositionRetryability(t *testing.T) {
	for name, testCase := range map[string]struct {
		err       error
		code      string
		retryable bool
	}{
		"capacity": {
			err:       evidenceStagingCapacity(),
			code:      evidenceStagingCapacityCode,
			retryable: true,
		},
		"oversize": {
			err:       evidenceStagingCandidateTooLarge(),
			code:      evidenceStagingCandidateTooLargeCode,
			retryable: false,
		},
	} {
		t.Run(name, func(t *testing.T) {
			code, retryable := classifyIngestDisposition(testCase.err)
			if code != testCase.code || retryable != testCase.retryable {
				t.Fatalf(
					"disposition = %q/%v, want %q/%v",
					code,
					retryable,
					testCase.code,
					testCase.retryable,
				)
			}
		})
	}
}
