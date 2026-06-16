package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type qualityProgressOpts struct {
	dir     string
	limit   int
	jsonOut bool
}

type qualityCellEvidenceOpts struct {
	dir         string
	caseID      string
	variantName string
	trial       int
	jsonOut     bool
}

// NewQualityProgressCmd creates `crux quality progress <evaluation-id>`.
func NewQualityProgressCmd() *cobra.Command {
	opts := &qualityProgressOpts{limit: 20}
	cmd := &cobra.Command{
		Use:          "progress <evaluation-id>",
		Short:        "Print recent experiment progress for one evaluation",
		Args:         cobra.ExactArgs(1),
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runQualityProgress(cmd.Context(), cmd.OutOrStdout(), args[0], *opts)
		},
	}
	cmd.Flags().StringVar(&opts.dir, "dir", "", "Quality persistence root (default: <config dir>/.crux/quality)")
	cmd.Flags().IntVar(&opts.limit, "limit", 20, "Maximum recent runs to include")
	cmd.Flags().BoolVar(&opts.jsonOut, "json", false, "Print the progress API record as JSON")
	return cmd
}

// NewQualityCellEvidenceCmd creates `crux quality cell-evidence <experiment-id>`.
func NewQualityCellEvidenceCmd() *cobra.Command {
	opts := &qualityCellEvidenceOpts{trial: -1}
	cmd := &cobra.Command{
		Use:          "cell-evidence <experiment-id>",
		Short:        "Print debug evidence for one experiment cell",
		Args:         cobra.ExactArgs(1),
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runQualityCellEvidence(cmd.Context(), cmd.OutOrStdout(), args[0], *opts)
		},
	}
	cmd.Flags().StringVar(&opts.dir, "dir", "", "Quality persistence root (default: <config dir>/.crux/quality)")
	cmd.Flags().StringVar(&opts.caseID, "case", "", "Case id for the selected cell")
	cmd.Flags().StringVar(&opts.variantName, "variant", "", "Variant name for the selected cell")
	cmd.Flags().IntVar(&opts.trial, "trial", -1, "Trial index for the selected cell")
	cmd.Flags().BoolVar(&opts.jsonOut, "json", false, "Print the cell evidence API record as JSON")
	return cmd
}

func runQualityProgress(ctx context.Context, out io.Writer, evaluationID string, opts qualityProgressOpts) error {
	if opts.limit < 0 {
		return fmt.Errorf("limit must be non-negative")
	}
	client := newQualityReadClient(opts.dir)
	progress, found, err := client.EvaluationProgress(ctx, evaluationID, opts.limit)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("evaluation %s not found", evaluationID)
	}
	if opts.jsonOut {
		return writeQualityReadJSON(out, progress)
	}
	_, err = fmt.Fprintf(out, "%s  %d run(s)\n", progress.EvaluationID, len(progress.Runs))
	return err
}

func runQualityCellEvidence(ctx context.Context, out io.Writer, experimentID string, opts qualityCellEvidenceOpts) error {
	if opts.caseID == "" {
		return fmt.Errorf("case is required")
	}
	if opts.variantName == "" {
		return fmt.Errorf("variant is required")
	}
	if opts.trial < 0 {
		return fmt.Errorf("trial must be non-negative")
	}
	client := newQualityReadClient(opts.dir)
	evidence, found, err := client.CellEvidence(ctx, api.QualityCellEvidenceQuery{
		ExperimentID: experimentID,
		CaseID:       opts.caseID,
		VariantName:  opts.variantName,
		Trial:        opts.trial,
	})
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("cell evidence for experiment %s not found", experimentID)
	}
	if opts.jsonOut {
		return writeQualityReadJSON(out, evidence)
	}
	_, err = fmt.Fprintf(out, "%s  %s/%s trial %d  %s\n",
		evidence.ExperimentID,
		evidence.Cell.CaseID,
		evidence.Cell.VariantName,
		evidence.Cell.Trial,
		evidence.Cell.Status,
	)
	return err
}

func newQualityReadClient(dir string) *devtools.DirectClient {
	s := store.NewStore()
	qualitySvc := quality.NewService(s, qualityReadDir(dir))
	return devtools.NewDirectClient(s, qualitySvc)
}

func qualityReadDir(dir string) string {
	if dir != "" {
		return dir
	}
	configDir := findConfigDir()
	if configDir == "" {
		configDir = "."
	}
	return filepath.Join(configDir, ".crux", "quality")
}

func writeQualityReadJSON(out io.Writer, record any) error {
	enc := json.NewEncoder(out)
	return enc.Encode(record)
}
