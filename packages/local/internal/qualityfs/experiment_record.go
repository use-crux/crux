package qualityfs

type Experiment struct {
	Tag            string                       `json:"_tag"`
	ID             string                       `json:"id"`
	QualityID      string                       `json:"qualityId"`
	Suite          ExperimentSuite              `json:"suite"`
	StartedAt      string                       `json:"startedAt"`
	EndedAt        string                       `json:"endedAt"`
	Status         string                       `json:"status"`
	Summary        ExperimentSummary            `json:"summary"`
	Variants       []ExperimentVariant          `json:"variants"`
	VariantConfigs map[string]VariantConfigDiff `json:"variantConfigs,omitempty"`
	Progress       *ExperimentProgress          `json:"progress,omitempty"`
	PrimaryScore   string                       `json:"primaryScore,omitempty"`
	Cells          []ExperimentCase             `json:"cells,omitempty"`
	Cases          []ExperimentCase             `json:"cases,omitempty"`
}

type ExperimentSummary struct {
	Total   int `json:"total"`
	Passed  int `json:"passed"`
	Failed  int `json:"failed"`
	Errored int `json:"errored"`
}

type ExperimentVariant struct {
	ID                    string   `json:"id"`
	TargetID              string   `json:"targetId"`
	DefinitionFingerprint string   `json:"definitionFingerprint,omitempty"`
	Label                 string   `json:"label,omitempty"`
	PassRate              *float64 `json:"passRate,omitempty"`
	MeanScore             *float64 `json:"meanScore,omitempty"`
	TokensAvg             *float64 `json:"tokensAvg,omitempty"`
	LatencyP95Ms          *float64 `json:"latencyP95Ms,omitempty"`
	CostTotal             *float64 `json:"costTotal,omitempty"`
	IsBaseline            bool     `json:"isBaseline,omitempty"`
	IsWinner              bool     `json:"isWinner,omitempty"`
	BaselineDeltaPassPts  *float64 `json:"baselineDeltaPassPts,omitempty"`
}

type VariantConfigDiff struct {
	VsBaselineVariantID string           `json:"vsBaselineVariantId"`
	Lines               []ConfigDiffLine `json:"lines"`
}

type ConfigDiffLine struct {
	Op   string `json:"op"`
	Text string `json:"text"`
	Note string `json:"note,omitempty"`
}

type ExperimentProgress struct {
	CasesDone      int      `json:"casesDone"`
	CasesTotal     int      `json:"casesTotal"`
	VariantsTotal  int      `json:"variantsTotal"`
	ProviderCalls  int      `json:"providerCalls"`
	EstRemainingMs *int64   `json:"estRemainingMs,omitempty"`
	Seed           *int64   `json:"seed,omitempty"`
	Temperature    *float64 `json:"temperature,omitempty"`
}

type ExperimentSuite struct {
	ID        string      `json:"id"`
	Name      string      `json:"name,omitempty"`
	Source    any         `json:"source,omitempty"`
	Path      string      `json:"path,omitempty"`
	CaseCount int         `json:"caseCount"`
	Tags      []string    `json:"tags,omitempty"`
	Snapshot  []SuiteCase `json:"snapshot,omitempty"`
}

type ExperimentCase struct {
	CaseID     string  `json:"caseId"`
	CaseName   string  `json:"caseName,omitempty"`
	VariantID  string  `json:"variantId"`
	Status     string  `json:"status"`
	DurationMs float64 `json:"durationMs"`
	Scores     []Score `json:"scores"`
	TraceID    string  `json:"traceId,omitempty"`
	Input      any     `json:"input,omitempty"`
	Output     any     `json:"output,omitempty"`
	Error      any     `json:"error,omitempty"`
}

type Score struct {
	Kind  string   `json:"kind"`
	Name  string   `json:"name"`
	Value *float64 `json:"value,omitempty"`
}

type ScoreSummary struct {
	Name  string
	Value *float64
}

func experimentCells(experiment Experiment) []ExperimentCase {
	if len(experiment.Cells) > 0 {
		return experiment.Cells
	}
	return experiment.Cases
}
