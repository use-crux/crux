package observability

// TurnDecisionReport is the backend-owned per-generation explanation read model.
type TurnDecisionReport struct {
	SchemaVersion int                      `json:"schemaVersion"`
	ReportID      string                   `json:"reportId"`
	RunID         string                   `json:"runId"`
	TraceID       string                   `json:"traceId,omitempty"`
	Turn          TurnDecisionTurn         `json:"turn"`
	Saw           []TurnSawItem            `json:"saw"`
	Considered    []TurnConsideredItem     `json:"considered"`
	Freshness     []TurnFreshnessEvidence  `json:"freshness"`
	Cache         []TurnCacheEvidence      `json:"cache"`
	Decisions     []TurnDecision           `json:"decisions"`
	Source        []TurnSourceGroup        `json:"source"`
	Coverage      TurnDecisionCoverage     `json:"coverage"`
	Gaps          []TurnDecisionDiagnostic `json:"gaps"`
	Chips         []TurnDecisionChip       `json:"chips,omitempty"`
}

// TurnDecisionTurn describes the model call or stream being explained.
type TurnDecisionTurn struct {
	ID           string              `json:"id"`
	Kind         string              `json:"kind"`
	Name         string              `json:"name,omitempty"`
	Model        string              `json:"model,omitempty"`
	Provider     string              `json:"provider,omitempty"`
	Status       string              `json:"status,omitempty"`
	FinishReason string              `json:"finishReason,omitempty"`
	DurMs        float64             `json:"durMs,omitempty"`
	TTFTMs       float64             `json:"ttftMs,omitempty"`
	Tokens       *TurnDecisionTokens `json:"tokens,omitempty"`
	Cost         *TurnDecisionCost   `json:"cost,omitempty"`
	Readout      string              `json:"readout,omitempty"`
}

// TurnDecisionTokens mirrors generation usage totals for the explained turn.
type TurnDecisionTokens struct {
	Input  float64 `json:"input,omitempty"`
	Output float64 `json:"output,omitempty"`
	Total  float64 `json:"total,omitempty"`
}

// TurnDecisionCost mirrors generation cost totals for the explained turn.
type TurnDecisionCost struct {
	TotalUSD  float64 `json:"totalUsd,omitempty"`
	InputUSD  float64 `json:"inputUsd,omitempty"`
	OutputUSD float64 `json:"outputUsd,omitempty"`
}

// TurnSawItem is an item that reached the model.
type TurnSawItem struct {
	Kind          string                 `json:"kind"`
	Name          string                 `json:"name,omitempty"`
	ID            string                 `json:"id,omitempty"`
	Disposition   string                 `json:"disposition"`
	Tokens        float64                `json:"tokens,omitempty"`
	Freshness     *TurnFreshnessEvidence `json:"freshness,omitempty"`
	Cache         *TurnCacheEvidence     `json:"cache,omitempty"`
	EvidenceLevel string                 `json:"evidenceLevel"`
	SourceStatus  string                 `json:"sourceStatus"`
	Source        *TurnSourceJoin        `json:"source,omitempty"`
	Tab           *TurnDeepTabTarget     `json:"tab,omitempty"`
}

// TurnConsideredItem is an item Crux checked but did not send to the model.
type TurnConsideredItem struct {
	Kind          string                 `json:"kind"`
	Name          string                 `json:"name,omitempty"`
	ID            string                 `json:"id,omitempty"`
	Disposition   string                 `json:"disposition"`
	ReasonState   string                 `json:"reasonState,omitempty"`
	Reason        TurnDecisionReason     `json:"reason,omitempty"`
	Tokens        float64                `json:"tokens,omitempty"`
	Freshness     *TurnFreshnessEvidence `json:"freshness,omitempty"`
	Cache         *TurnCacheEvidence     `json:"cache,omitempty"`
	EvidenceLevel string                 `json:"evidenceLevel"`
	SourceStatus  string                 `json:"sourceStatus"`
	Source        *TurnSourceJoin        `json:"source,omitempty"`
	Required      bool                   `json:"required,omitempty"`
	Tab           *TurnDeepTabTarget     `json:"tab,omitempty"`
}

// TurnFreshnessEvidence records whether data was current enough for the turn.
type TurnFreshnessEvidence struct {
	Subject       TurnDecisionSubject `json:"subject"`
	Status        string              `json:"status"`
	AgeMs         float64             `json:"ageMs,omitempty"`
	MaxAgeMs      float64             `json:"maxAgeMs,omitempty"`
	ObservedAt    string              `json:"observedAt,omitempty"`
	ValidUntil    string              `json:"validUntil,omitempty"`
	SourceVersion string              `json:"sourceVersion,omitempty"`
	Reason        string              `json:"reason,omitempty"`
	EvidenceLevel string              `json:"evidenceLevel,omitempty"`
}

// TurnCacheEvidence records reuse, cache writes, and provider token caching.
type TurnCacheEvidence struct {
	Subject             TurnDecisionSubject `json:"subject"`
	Status              string              `json:"status"`
	CacheKey            string              `json:"cacheKey,omitempty"`
	AgeMs               float64             `json:"ageMs,omitempty"`
	TTLMS               float64             `json:"ttlMs,omitempty"`
	SavedTokens         float64             `json:"savedTokens,omitempty"`
	SavedCostUSD        float64             `json:"savedCostUsd,omitempty"`
	AcceptedByFreshness bool                `json:"acceptedByFreshness,omitempty"`
	RejectedByFreshness bool                `json:"rejectedByFreshness,omitempty"`
	Reason              string              `json:"reason,omitempty"`
	EvidenceLevel       string              `json:"evidenceLevel,omitempty"`
	Tab                 *TurnDeepTabTarget  `json:"tab,omitempty"`
}

// TurnDecision is a compact row describing one recorded decision.
type TurnDecision struct {
	ID        string                 `json:"id"`
	Phase     string                 `json:"phase"`
	Kind      string                 `json:"kind"`
	Subject   TurnDecisionSubject    `json:"subject"`
	Outcome   string                 `json:"outcome"`
	Reason    TurnDecisionReason     `json:"reason"`
	Source    *TurnSourceJoin        `json:"source,omitempty"`
	Coverage  *TurnCoverageArea      `json:"coverage,omitempty"`
	Tab       *TurnDeepTabTarget     `json:"tab,omitempty"`
	Evidence  []TurnEvidenceRef      `json:"evidence,omitempty"`
	Freshness *TurnFreshnessEvidence `json:"freshness,omitempty"`
	Cache     *TurnCacheEvidence     `json:"cache,omitempty"`
	Metrics   *TurnDecisionMetrics   `json:"metrics,omitempty"`
}

// TurnDecisionSubject identifies the thing a decision acted on.
type TurnDecisionSubject struct {
	Kind  string `json:"kind"`
	ID    string `json:"id,omitempty"`
	Name  string `json:"name,omitempty"`
	Label string `json:"label,omitempty"`
}

// TurnDecisionReason separates stable reason codes from human text.
type TurnDecisionReason struct {
	Code          string `json:"code"`
	Text          string `json:"text"`
	EvidenceLevel string `json:"evidenceLevel"`
	Source        string `json:"source"`
}

// TurnSourceGroup groups source joins for the source panel.
type TurnSourceGroup struct {
	Group string           `json:"group"`
	Items []TurnSourceJoin `json:"items"`
}

// TurnSourceJoin points from runtime evidence back to source definitions when possible.
type TurnSourceJoin struct {
	ID               string          `json:"id,omitempty"`
	Kind             string          `json:"kind,omitempty"`
	Name             string          `json:"name,omitempty"`
	File             string          `json:"file,omitempty"`
	Line             int             `json:"line,omitempty"`
	Column           int             `json:"column,omitempty"`
	Status           string          `json:"status"`
	Fidelity         string          `json:"fidelity"`
	SourceRefs       []TurnSourceRef `json:"sourceRefs,omitempty"`
	UnresolvedReason string          `json:"unresolvedReason,omitempty"`
}

// TurnSourceRef is an optional concrete file reference from Project Index data.
type TurnSourceRef struct {
	Role    string `json:"role,omitempty"`
	File    string `json:"file,omitempty"`
	Line    int    `json:"line,omitempty"`
	Column  int    `json:"column,omitempty"`
	Snippet string `json:"snippet,omitempty"`
}

// TurnDecisionCoverage is the scorecard for quality protection.
type TurnDecisionCoverage struct {
	Covered int                `json:"covered"`
	Total   int                `json:"total"`
	Areas   []TurnCoverageArea `json:"areas"`
}

// TurnCoverageArea describes one quality protection area. ID is stable for
// matchers and filtering; Label is display copy.
type TurnCoverageArea struct {
	ID            string `json:"id"`
	Label         string `json:"label"`
	Status        string `json:"status"`
	Suggestion    string `json:"suggestion,omitempty"`
	Command       string `json:"command,omitempty"`
	EvidenceLevel string `json:"evidenceLevel,omitempty"`
}

// TurnDecisionDiagnostic records missing or inferred evidence.
type TurnDecisionDiagnostic struct {
	Code          string               `json:"code,omitempty"`
	Text          string               `json:"text"`
	Detail        string               `json:"detail,omitempty"`
	EvidenceLevel string               `json:"evidenceLevel"`
	Subject       *TurnDecisionSubject `json:"subject,omitempty"`
	Evidence      []TurnEvidenceRef    `json:"evidence,omitempty"`
}

// TurnDecisionChip is an optional stable scan/filter chip.
type TurnDecisionChip struct {
	ID     string                  `json:"id"`
	Label  string                  `json:"label"`
	Tone   string                  `json:"tone,omitempty"`
	Filter *TurnDecisionChipFilter `json:"filter,omitempty"`
}

// TurnDecisionChipFilter identifies a report section and optional value.
type TurnDecisionChipFilter struct {
	Target string `json:"target"`
	Value  string `json:"value,omitempty"`
}

// TurnDeepTabTarget links a report row to an existing Run Detail tab.
type TurnDeepTabTarget struct {
	Tab        string `json:"tab"`
	AnchorID   string `json:"anchorId,omitempty"`
	ArtifactID string `json:"artifactId,omitempty"`
	SpanID     string `json:"spanId,omitempty"`
}

// TurnEvidenceRef points at the recorded span, artifact, event, or edge evidence.
type TurnEvidenceRef struct {
	Kind         string `json:"kind"`
	SpanID       string `json:"spanId,omitempty"`
	Primitive    string `json:"primitive,omitempty"`
	ArtifactID   string `json:"artifactId,omitempty"`
	ArtifactKind string `json:"artifactKind,omitempty"`
	Name         string `json:"name,omitempty"`
	EdgeType     string `json:"edgeType,omitempty"`
	FromID       string `json:"fromId,omitempty"`
	ToID         string `json:"toId,omitempty"`
	Role         string `json:"role"`
}

// TurnDecisionMetrics carries compact metrics associated with one row.
type TurnDecisionMetrics struct {
	Tokens        float64 `json:"tokens,omitempty"`
	StaticTokens  float64 `json:"staticTokens,omitempty"`
	DynamicTokens float64 `json:"dynamicTokens,omitempty"`
	Priority      float64 `json:"priority,omitempty"`
	SizeBytes     float64 `json:"sizeBytes,omitempty"`
	DurationMs    float64 `json:"durationMs,omitempty"`
	CostUSD       float64 `json:"costUsd,omitempty"`
	Score         float64 `json:"score,omitempty"`
	Confidence    float64 `json:"confidence,omitempty"`
}
