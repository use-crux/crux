package observability

const (
	evidenceCandidateDigestVersion     = 1
	evidenceCandidateMaxBytes          = 512 * 1024
	evidenceCandidatesPerEvidence      = 4
	evidenceCandidatesPerNamespace     = 512
	evidenceCandidateBytesPerNamespace = 16 * 1024 * 1024
	evidenceCandidatesPerProject       = 2_000
	evidenceCandidateBytesPerProject   = 64 * 1024 * 1024
)
