package observability

const (
	evidenceStagingCapacityCode          = "EVIDENCE_STAGING_CAPACITY"
	evidenceStagingCandidateTooLargeCode = "EVIDENCE_STAGING_CANDIDATE_TOO_LARGE"
)

func evidenceStagingCapacity() error {
	return &evidenceDispositionError{
		code:      evidenceStagingCapacityCode,
		retryable: true,
	}
}

func evidenceStagingCandidateTooLarge() error {
	return &evidenceDispositionError{
		code:      evidenceStagingCandidateTooLargeCode,
		retryable: false,
	}
}
