package qualitycmd

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/domain"
)

const qualityRunSummarySchemaVersion = 1

// qualityRunSummary is the machine-readable result for `crux quality run --json`.
// It is intentionally compact: agents get the verdict, record paths, failure
// pointers, and a plain-language summary without parsing human output.
type qualityRunSummary struct {
	SchemaVersion int                           `json:"schemaVersion"`
	RunID         string                        `json:"runId,omitempty"`
	Passed        bool                          `json:"passed"`
	ExitCode      int                           `json:"exitCode"`
	Evaluations   []qualityRunEvaluationSummary `json:"evaluations"`
	Summary       string                        `json:"summary"`
	Error         *qualityRunSummaryError       `json:"error,omitempty"`
}

type qualityRunSummaryError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type qualityRunEvaluationSummary struct {
	ID           string                     `json:"id"`
	ExperimentID string                     `json:"experimentId,omitempty"`
	RecordPath   string                     `json:"recordPath,omitempty"`
	Passed       bool                       `json:"passed"`
	Gates        []domain.QualityGateResult `json:"gates"`
	Cells        qualityRunCellSummary      `json:"cells"`
	Failures     []qualityRunFailureSummary `json:"failures,omitempty"`
	Cost         qualityRunCostSummary      `json:"cost"`
	DurationMs   float64                    `json:"durationMs"`
}

type qualityRunCellSummary struct {
	Total   int `json:"total"`
	Passed  int `json:"passed"`
	Failed  int `json:"failed"`
	Errored int `json:"errored"`
	Skipped int `json:"skipped"`
}

type qualityRunFailureSummary struct {
	CaseID            string                     `json:"caseId"`
	Variant           string                     `json:"variant"`
	Trial             int                        `json:"trial"`
	Phase             string                     `json:"phase"`
	Summary           string                     `json:"summary"`
	DatasetProvenance *renderedDatasetProvenance `json:"datasetProvenance,omitempty"`
	Evidence          qualityRunFailureEvidence  `json:"evidence"`
}

type qualityRunFailureEvidence struct {
	RecordPath          string `json:"recordPath,omitempty"`
	CellEvidenceCommand string `json:"cellEvidenceCommand"`
}

type qualityRunCostSummary struct {
	TotalUsd float64 `json:"totalUsd"`
}

func buildQualityRunSummary(
	reporter *qualityReporter,
	exitCode int,
	runErr *qualityRunSummaryError,
) qualityRunSummary {
	summary := qualityRunSummary{
		SchemaVersion: qualityRunSummarySchemaVersion,
		RunID:         reporter.runID,
		Passed:        exitCode == 0,
		ExitCode:      exitCode,
		Evaluations:   make([]qualityRunEvaluationSummary, 0, len(reporter.order)),
		Error:         runErr,
	}
	for _, evaluationID := range reporter.order {
		state := reporter.evals[evaluationID]
		if state == nil {
			continue
		}
		summary.Evaluations = append(summary.Evaluations, buildQualityRunEvaluationSummary(state, recordPathForEvaluation(reporter, state)))
	}
	summary.Summary = qualityRunPlainSummary(summary)
	return summary
}

func buildQualityRunEvaluationSummary(state *qualityEvalState, recordPath string) qualityRunEvaluationSummary {
	out := qualityRunEvaluationSummary{
		ID:           state.evaluationID,
		ExperimentID: state.experimentID,
		RecordPath:   recordPath,
		Passed:       true,
		Gates:        nil,
	}
	if state.gates != nil {
		out.Gates = state.gates.Results
		out.Passed = state.gates.Passed
	} else if state.aggregates == nil {
		out.Passed = false
	}
	if state.aggregates != nil {
		for _, aggregate := range state.aggregates.PerVariant {
			out.Cells.Total += aggregate.Cells
			out.Cells.Passed += aggregate.Passed
			out.Cells.Failed += aggregate.Failed
			out.Cells.Errored += aggregate.Errored
			out.Cells.Skipped += aggregate.Skipped
			out.Cost.TotalUsd += aggregate.CostUsd
		}
	}
	for _, cell := range state.cells {
		out.DurationMs += cell.DurationMs
		out.Cost.TotalUsd += cell.CostUsd
		if cell.Status == "failed" || cell.Status == "errored" || cell.Status == "error" {
			out.Failures = append(out.Failures, qualityRunFailure(cell, state.experimentID, recordPath))
			out.Passed = false
		}
	}
	return out
}

func qualityRunFailure(cell domain.QualityCell, experimentID string, recordPath string) qualityRunFailureSummary {
	phase, message := qualityRunFailureMessage(cell)
	var datasetProvenance *renderedDatasetProvenance
	if provenance, ok := datasetProvenanceFromCell(&cell); ok {
		datasetProvenance = &provenance
	}
	return qualityRunFailureSummary{
		CaseID:            cell.CaseID,
		Variant:           cell.VariantName,
		Trial:             cell.Trial,
		Phase:             phase,
		Summary:           message,
		DatasetProvenance: datasetProvenance,
		Evidence: qualityRunFailureEvidence{
			RecordPath:          recordPath,
			CellEvidenceCommand: qualityCellEvidenceCommand(experimentID, cell),
		},
	}
}

func qualityRunFailureMessage(cell domain.QualityCell) (string, string) {
	if cell.Error != nil {
		return nonEmptyString(cell.Error.Phase, "task"), nonEmptyString(cell.Error.Message, "cell errored")
	}
	for _, outcome := range cell.Assertions.Outcomes {
		if outcome.Status == "failed" || outcome.Status == "errored" || outcome.Status == "uncaptured" {
			return nonEmptyString(outcome.Phase, "expect"), nonEmptyString(outcome.Message, outcome.Matcher, "assertion failed")
		}
	}
	return "cell", nonEmptyString(cell.Status, "cell failed")
}

func qualityCellEvidenceCommand(experimentID string, cell domain.QualityCell) string {
	return fmt.Sprintf(
		"crux quality cell-evidence %s --case %s --variant %s --trial %d --json",
		shellToken(experimentID),
		shellToken(cell.CaseID),
		shellToken(cell.VariantName),
		cell.Trial,
	)
}

func shellToken(value string) string {
	if value == "" {
		return "''"
	}
	if strings.ContainsAny(value, " \t\n\r\"'\\") {
		escaped := strings.ReplaceAll(value, "'", "'\\''")
		return "'" + escaped + "'"
	}
	return value
}

func qualityRunPlainSummary(summary qualityRunSummary) string {
	if summary.Error != nil {
		return "quality run failed: " + summary.Error.Message
	}
	if len(summary.Evaluations) == 0 {
		if summary.Passed {
			return "quality run passed: no evaluations executed."
		}
		return "quality run failed: no evaluations completed."
	}
	first := summary.Evaluations[0]
	failed := first.Cells.Failed + first.Cells.Errored
	if summary.Passed {
		return fmt.Sprintf("%s passed: %d/%d cells passed.", first.ID, first.Cells.Passed, first.Cells.Total)
	}
	suffix := ""
	if failed != 1 {
		suffix = "s"
	}
	baseline := ""
	if failed > 0 {
		baseline = " vs baseline"
	}
	return fmt.Sprintf("%s regressed: %d case%s failed%s; failures point at %s.", first.ID, failed, suffix, baseline, first.ID)
}

func recordPathForEvaluation(reporter *qualityReporter, state *qualityEvalState) string {
	if state.experimentID == "" {
		return ""
	}
	for _, recordPath := range reporter.recordPaths {
		if strings.Contains(filepath.Base(recordPath), state.experimentID) {
			return recordPath
		}
	}
	if len(reporter.recordPaths) == 1 {
		return reporter.recordPaths[0]
	}
	return ""
}

func writeQualityRunSummaryToWriter(w io.Writer, summary qualityRunSummary) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(summary)
}

func writeQualityRunSummaryToFile(path string, summary qualityRunSummary) error {
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return writeQualityRunSummaryToWriter(file, summary)
}
