package protocol

const (
	// PromptTextMethod identifies the cache-bypassing compiler query.
	PromptTextMethod = "promptTextQuery"
	// PromptTextProtocolVersion is the Rust-to-Go JSON ABI version.
	PromptTextProtocolVersion uint16 = 1
)

// PromptTextPosition is a zero-based UTF-16 source position.
type PromptTextPosition struct {
	Line      uint32 `json:"line"`
	Character uint32 `json:"character"`
}

// PromptTextRange is a half-open UTF-16 source range.
type PromptTextRange struct {
	Start PromptTextPosition `json:"start"`
	End   PromptTextPosition `json:"end"`
}

// PromptTextOffsetRange is a half-open UTF-16 offset range within one island.
type PromptTextOffsetRange struct {
	Start uint32 `json:"start"`
	End   uint32 `json:"end"`
}

// PromptTextDocumentRevision identifies the exact open buffer analyzed.
type PromptTextDocumentRevision struct {
	OpenEpoch  uint64 `json:"openEpoch"`
	Version    int64  `json:"version"`
	SourceHash string `json:"sourceHash"`
}

// PromptTextStatusKind is the completeness discriminant used at request and
// template level.
type PromptTextStatusKind string

const (
	PromptTextStatusComplete    PromptTextStatusKind = "complete"
	PromptTextStatusTruncated   PromptTextStatusKind = "truncated"
	PromptTextStatusUnsupported PromptTextStatusKind = "unsupported"
)

// PromptTextAnalysisStatus reports whether a request or template is complete.
type PromptTextAnalysisStatus struct {
	Kind PromptTextStatusKind `json:"kind"`
}

// PromptTextLimits centralizes transient projection and output bounds.
type PromptTextLimits struct {
	MaxSourceBytes               uint32 `json:"maxSourceBytes"`
	MaxTemplates                 uint32 `json:"maxTemplates"`
	MaxTemplateBytes             uint32 `json:"maxTemplateBytes"`
	MaxTraversalNodes            uint32 `json:"maxTraversalNodes"`
	MaxOutputBytes               uint32 `json:"maxOutputBytes"`
	MaxStringRefactors           uint32 `json:"maxStringRefactors"`
	MaxStringRefactorBytes       uint32 `json:"maxStringRefactorBytes"`
	MaxStringRefactorOutputBytes uint32 `json:"maxStringRefactorOutputBytes"`
	MaxFragments                 uint32 `json:"maxFragments"`
	MaxFragmentJoins             uint32 `json:"maxFragmentJoins"`
	MaxFragmentBytes             uint32 `json:"maxFragmentBytes"`
	MaxFragmentDepth             uint32 `json:"maxFragmentDepth"`
	MaxPreviewBytes              uint32 `json:"maxPreviewBytes"`
}

// PromptTextFragment is one bounded, semantically proven fragment input.
type PromptTextFragment struct {
	ID         string          `json:"id"`
	Symbol     string          `json:"symbol"`
	File       string          `json:"file"`
	SourceHash string          `json:"sourceHash"`
	Range      PromptTextRange `json:"range"`
	Snippet    string          `json:"snippet"`
}

// PromptTextEvidenceProof identifies an externally verified evidence edge.
type PromptTextEvidenceProof string

const (
	// PromptTextProofSemanticExact is a current semantic fragment resolution.
	PromptTextProofSemanticExact PromptTextEvidenceProof = "semantic-exact"
)

// PromptTextInterpolationJoinKey identifies one exact interpolation occurrence.
type PromptTextInterpolationJoinKey struct {
	File            string          `json:"file"`
	SourceHash      string          `json:"sourceHash"`
	TemplateRange   PromptTextRange `json:"templateRange"`
	Interpolation   uint32          `json:"interpolation"`
	ExpressionRange PromptTextRange `json:"expressionRange"`
}

// PromptTextFragmentJoin resolves one interpolation to a supplied fragment.
type PromptTextFragmentJoin struct {
	Key        PromptTextInterpolationJoinKey `json:"key"`
	FragmentID string                         `json:"fragmentId"`
	Proof      PromptTextEvidenceProof        `json:"proof"`
}

// PromptTextQuery is one exact, cache-bypassing open-document query.
type PromptTextQuery struct {
	ProtocolVersion uint16                     `json:"protocolVersion"`
	File            string                     `json:"file"`
	LanguageID      string                     `json:"languageId"`
	Revision        PromptTextDocumentRevision `json:"revision"`
	Source          string                     `json:"source"`
	Fragments       []PromptTextFragment       `json:"fragments"`
	FragmentJoins   []PromptTextFragmentJoin   `json:"fragmentJoins"`
	Limits          PromptTextLimits           `json:"limits"`
}

// PromptTextWorkerRequest wraps one query for the persistent compiler process.
type PromptTextWorkerRequest struct {
	ID     uint64          `json:"id"`
	Method string          `json:"method"`
	Query  PromptTextQuery `json:"query"`
}

// PromptTextRefactorProofLevel identifies compiler-owned proof strength.
type PromptTextRefactorProofLevel string

const (
	PromptTextRefactorProofSyntaxExact PromptTextRefactorProofLevel = "syntax-exact"
)

// PromptTextRefactorProof is one exact ordinary-string conversion proof.
type PromptTextRefactorProof struct {
	Kind         string                       `json:"kind"`
	CandidateID  uint32                       `json:"candidateId"`
	Range        PromptTextRange              `json:"range"`
	ExpectedText string                       `json:"expectedText"`
	TemplateText string                       `json:"templateText"`
	Proof        PromptTextRefactorProofLevel `json:"proof"`
}

// PromptTextRefactorAnalysis has limits and completeness independent from
// tagged-template analysis.
type PromptTextRefactorAnalysis struct {
	Status PromptTextAnalysisStatus  `json:"status"`
	Proofs []PromptTextRefactorProof `json:"proofs"`
}

// PromptTextQueryResponse is one normalized result for an exact revision.
type PromptTextQueryResponse struct {
	ProtocolVersion uint16                     `json:"protocolVersion"`
	File            string                     `json:"file"`
	Revision        PromptTextDocumentRevision `json:"revision"`
	Status          PromptTextAnalysisStatus   `json:"status"`
	Templates       []PromptTextTemplate       `json:"templates"`
	Refactors       PromptTextRefactorAnalysis `json:"refactors"`
}
