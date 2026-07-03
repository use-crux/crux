package screens

import (
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

type experimentExportedMsg struct {
	experimentID string
	path         string
}

func (s *Experiments) exportExperiment() tea.Cmd {
	if s.detail == nil {
		return nil
	}
	rec := *s.detail
	return func() tea.Msg {
		home, err := os.UserHomeDir()
		if err != nil {
			return dataErrMsg(err.Error())
		}
		dir := filepath.Join(home, ".crux", "exports")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return dataErrMsg(err.Error())
		}
		path := filepath.Join(dir, "experiment-"+truncate(rec.ExperimentID, 32)+".csv")
		if err := writeExperimentCSV(path, rec); err != nil {
			return dataErrMsg(err.Error())
		}
		return experimentExportedMsg{experimentID: rec.ExperimentID, path: path}
	}
}

// writeExperimentCSV exports variant-level metrics from a loaded experiment
// detail record. It does not start, compare, or mutate experiments.
func writeExperimentCSV(path string, rec api.QualityExperimentDetail) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	if err := writer.Write([]string{
		"experiment_id",
		"evaluation_id",
		"variant",
		"cells",
		"passed",
		"failed",
		"pass_rate",
		"score_mean",
		"latency_p95_ms",
		"cost_usd",
	}); err != nil {
		return err
	}
	for _, name := range experimentCSVVariants(rec) {
		agg := rec.Aggregates.PerVariant[name]
		if err := writer.Write([]string{
			rec.ExperimentID,
			rec.EvaluationID,
			name,
			fmt.Sprint(agg.Cells),
			fmt.Sprint(agg.Passed),
			fmt.Sprint(agg.Failed),
			fmt.Sprintf("%.4f", agg.PassRate),
			experimentCSVScoreMean(agg),
			fmt.Sprintf("%.1f", agg.Latency.P95Ms),
			experimentCSVCost(agg),
		}); err != nil {
			return err
		}
	}
	writer.Flush()
	return writer.Error()
}

func experimentCSVVariants(rec api.QualityExperimentDetail) []string {
	seen := make(map[string]bool, len(rec.Aggregates.PerVariant))
	names := make([]string, 0, len(rec.Aggregates.PerVariant))
	for _, variant := range rec.Variants {
		if _, ok := rec.Aggregates.PerVariant[variant.Name]; ok && !seen[variant.Name] {
			names = append(names, variant.Name)
			seen[variant.Name] = true
		}
	}
	extra := make([]string, 0)
	for name := range rec.Aggregates.PerVariant {
		if !seen[name] {
			extra = append(extra, name)
		}
	}
	sort.Strings(extra)
	return append(names, extra...)
}

func experimentCSVScoreMean(agg api.QualityVariantAggregate) string {
	if score, ok := agg.Scores["overall"]; ok {
		return fmt.Sprintf("%.4f", score.Mean)
	}
	names := make([]string, 0, len(agg.Scores))
	for name := range agg.Scores {
		names = append(names, name)
	}
	sort.Strings(names)
	if len(names) == 0 {
		return ""
	}
	return fmt.Sprintf("%.4f", agg.Scores[names[0]].Mean)
}

func experimentCSVCost(agg api.QualityVariantAggregate) string {
	if agg.CostUsd == nil {
		return ""
	}
	return fmt.Sprintf("%.4f", *agg.CostUsd)
}
