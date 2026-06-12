package domain

import "encoding/json"

// Quality runner NDJSON protocol (spec 03 §2) — the single event stream
// emitted by quality-runner.mjs. One struct per stream; unknown fields are
// ignored by design (schemas are additive-only, spec 02).

// QualityEvent is one line of the quality runner NDJSON stream.
type QualityEvent struct {
	Type string `json:"type"`

	// collect:done
	Evaluations []QualityManifest     `json:"evaluations,omitempty"`
	Errors      []QualityCollectError `json:"errors,omitempty"`

	// eval:start / cell:* / eval:done
	EvaluationID string `json:"evaluationId,omitempty"`
	Cells        int    `json:"cells,omitempty"`

	// cell:start
	CaseID      string `json:"caseId,omitempty"`
	CaseName    string `json:"caseName,omitempty"`
	VariantName string `json:"variantName,omitempty"`
	Trial       int    `json:"trial,omitempty"`

	// cell:done
	Cell *QualityCell `json:"cell,omitempty"`

	// eval:done
	ExperimentID      string              `json:"experimentId,omitempty"`
	ConfigFingerprint string              `json:"configFingerprint,omitempty"`
	Aggregates        *QualityAggregates  `json:"aggregates,omitempty"`
	Gates             *QualityGates       `json:"gates,omitempty"`
	FilteredRun       bool                `json:"filteredRun,omitempty"`
	Comparison        *QualityComparison  `json:"comparison,omitempty"`
	BaselineRef       *QualityBaselineRef `json:"baselineRef,omitempty"`
	RecordPath        string              `json:"recordPath,omitempty"`

	// promote:done
	BaselineID string `json:"baselineId,omitempty"`
	Path       string `json:"path,omitempty"`
	PinHint    string `json:"pinHint,omitempty"`

	// run:done
	Experiments []string `json:"experiments,omitempty"`
	ExitCode    int      `json:"exitCode,omitempty"`

	// error
	Scope   string `json:"scope,omitempty"`
	Message string `json:"message,omitempty"`
	File    string `json:"file,omitempty"`
	Line    int    `json:"line,omitempty"`
}

// QualityCollectError is a definition/discovery problem (CLI exit code 2).
type QualityCollectError struct {
	Message string `json:"message"`
	File    string `json:"file,omitempty"`
}

// QualityManifest carries the collect-time facts of one evaluation
// (spec 02 §2). Only the fields the CLI renders are mirrored here.
type QualityManifest struct {
	ID         string `json:"id"`
	ExplicitID bool   `json:"explicitId"`
	File       string `json:"file"`
	ExportName string `json:"exportName"`
	Source     string `json:"source"`
	Task       struct {
		Kind         string   `json:"kind"`
		Ref          string   `json:"ref,omitempty"`
		Capabilities []string `json:"capabilities"`
	} `json:"task"`
	Cases []struct {
		CaseID string `json:"caseId"`
		Name   string `json:"name,omitempty"`
		Trials int    `json:"trials"`
	} `json:"cases"`
	Datasets []struct {
		Path      string `json:"path"`
		CaseCount *int   `json:"caseCount,omitempty"`
	} `json:"datasets"`
	Scorers []struct {
		Name      string `json:"name"`
		CostClass string `json:"costClass"`
	} `json:"scorers"`
	Variants []struct {
		Name         string   `json:"name"`
		OverrideKeys []string `json:"overrideKeys"`
	} `json:"variants"`
	Trials int `json:"trials"`
	Flags  struct {
		Only bool `json:"only"`
		Skip bool `json:"skip"`
	} `json:"flags"`
}

// QualityCell is one experiment cell (case × variant × trial, spec 02 §1).
type QualityCell struct {
	CaseID      string  `json:"caseId"`
	CaseName    string  `json:"caseName,omitempty"`
	VariantName string  `json:"variantName"`
	Trial       int     `json:"trial"`
	Status      string  `json:"status"`
	SkipReason  string  `json:"skipReason,omitempty"`
	DurationMs  float64 `json:"durationMs"`
	CostUsd     float64 `json:"costUsd,omitempty"`

	Scores []struct {
		Name  string   `json:"name"`
		Score *float64 `json:"score"`
		Label string   `json:"label,omitempty"`
	} `json:"scores"`

	Assertions struct {
		Ran          int                       `json:"ran"`
		NotEvaluated int                       `json:"notEvaluated"`
		Failures     []QualityAssertionFailure `json:"failures"`
	} `json:"assertions"`

	Error *struct {
		Message            string `json:"message"`
		Phase              string `json:"phase"`
		MissingCassetteKey string `json:"missingCassetteKey,omitempty"`
	} `json:"error,omitempty"`

	TraceIDs        []string         `json:"traceIds"`
	CapturedSignals []string         `json:"capturedSignals"`
	Metadata        *json.RawMessage `json:"metadata,omitempty"`
}

// QualityAssertionFailure is one recorded expect failure (spec 02 §1).
type QualityAssertionFailure struct {
	Level           string `json:"level"`
	Index           int    `json:"index"`
	Matcher         string `json:"matcher"`
	Soft            bool   `json:"soft"`
	Message         string `json:"message"`
	ExpectedPreview string `json:"expectedPreview,omitempty"`
	ActualPreview   string `json:"actualPreview,omitempty"`
	SourceRef       string `json:"sourceRef,omitempty"`
}

// QualityAggregates mirrors ExperimentRecord.aggregates.
type QualityAggregates struct {
	PerVariant map[string]QualityVariantAggregate `json:"perVariant"`
}

// QualityVariantAggregate mirrors VariantAggregate (spec 02 §1).
type QualityVariantAggregate struct {
	Cells    int     `json:"cells"`
	Passed   int     `json:"passed"`
	Failed   int     `json:"failed"`
	Errored  int     `json:"errored"`
	Skipped  int     `json:"skipped"`
	PassRate float64 `json:"passRate"`
	Scores   map[string]struct {
		Mean float64 `json:"mean"`
		Sem  float64 `json:"sem"`
		N    int     `json:"n"`
	} `json:"scores"`
	Consistency *struct {
		PassAtK       float64 `json:"passAtK"`
		PassAllTrials float64 `json:"passAllTrials"`
	} `json:"consistency,omitempty"`
	Latency struct {
		MeanMs float64 `json:"meanMs"`
		P95Ms  float64 `json:"p95Ms"`
	} `json:"latency"`
	CostUsd float64 `json:"costUsd,omitempty"`
}

// QualityComparison mirrors ComparisonResult (spec 02 §1) — question-level
// paired differences against a variant or promoted baseline.
type QualityComparison struct {
	Kind     string `json:"kind"`
	Baseline string `json:"baseline"`
	Deltas   []struct {
		VariantName string  `json:"variantName"`
		ScoreName   string  `json:"scoreName"`
		MeanDelta   float64 `json:"meanDelta"`
		Sem         float64 `json:"sem"`
		N           int     `json:"n"`
	} `json:"deltas"`
	UnmatchedCases struct {
		BaselineOnly  []string `json:"baselineOnly"`
		CandidateOnly []string `json:"candidateOnly"`
	} `json:"unmatchedCases"`
	// Present when the comparison is informational (configFingerprint drift).
	Demoted *struct {
		Reason string `json:"reason"`
	} `json:"demoted,omitempty"`
}

// QualityBaselineRef mirrors ExperimentRecord.baselineRef.
type QualityBaselineRef struct {
	BaselineID   string `json:"baselineId"`
	ExperimentID string `json:"experimentId"`
	VariantName  string `json:"variantName,omitempty"`
}

// QualityGates mirrors ExperimentRecord.gates.
type QualityGates struct {
	Passed        bool                `json:"passed"`
	Informational bool                `json:"informational"`
	Results       []QualityGateResult `json:"results"`
}

// QualityGateResult mirrors GateResult (spec 02 §1).
type QualityGateResult struct {
	Gate        string          `json:"gate"`
	VariantName string          `json:"variantName,omitempty"`
	Threshold   json.RawMessage `json:"threshold"`
	Actual      json.RawMessage `json:"actual"`
	Passed      bool            `json:"passed"`
	// True when the gate could not be evaluated as blocking (no baseline
	// yet, or the promoted baseline drifted). Never fails a run.
	Informational bool `json:"informational,omitempty"`
}
