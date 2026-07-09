package qualitycmd

import (
	"context"
	"fmt"
	"io"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/qualityfs"
)

type qualityLabelOpts struct {
	dir         string
	caseID      string
	variantName string
	trial       int
	verdict     string
	scoreName   string
	note        string
}

// NewQualityLabelCmd creates `crux quality label <experiment-id>`.
func NewQualityLabelCmd(f *cli.Factory) *cobra.Command {
	opts := &qualityLabelOpts{variantName: "default", trial: 0}
	cmd := &cobra.Command{
		Use:          "label <experiment-id>",
		Short:        "Record a human pass/fail label for one experiment cell",
		Args:         cobra.ExactArgs(1),
		SilenceUsage: true,
		Example:      "  crux quality label 01KT... --case refund-policy --verdict pass --score helpful --note \"matches policy\"",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runQualityLabel(cmd.Context(), cmd.OutOrStdout(), args[0], *opts)
		},
	}
	cmd.Flags().StringVar(&opts.dir, "dir", "", "Quality persistence root (default: <project root>/.crux/quality)")
	cmd.Flags().StringVar(&opts.caseID, "case", "", "Case id for the selected cell")
	cmd.Flags().StringVar(&opts.variantName, "variant", "default", "Variant name for the selected cell")
	cmd.Flags().IntVar(&opts.trial, "trial", 0, "Trial index for the selected cell")
	cmd.Flags().StringVar(&opts.verdict, "verdict", "", "Human verdict: pass or fail")
	cmd.Flags().StringVar(&opts.scoreName, "score", "", "Optional judge score name this label calibrates")
	cmd.Flags().StringVar(&opts.note, "note", "", "Optional human note")
	return cmd
}

func runQualityLabel(_ context.Context, out io.Writer, experimentID string, opts qualityLabelOpts) error {
	if opts.caseID == "" {
		return fmt.Errorf("case is required")
	}
	if opts.trial < 0 {
		return fmt.Errorf("trial must be non-negative")
	}
	rating, err := labelRating(opts.verdict)
	if err != nil {
		return err
	}
	metadata := map[string]any{
		"variant": opts.variantName,
		"trial":   opts.trial,
	}
	if opts.scoreName != "" {
		metadata["scoreName"] = opts.scoreName
	}
	record := qualityfs.Feedback{
		ExperimentID: stringPtr(experimentID),
		CaseID:       stringPtr(opts.caseID),
		Rating:       intPtr(rating),
		Tags:         []string{"human-label"},
		Metadata:     metadata,
	}
	if opts.note != "" {
		record.Comment = stringPtr(opts.note)
	}
	saved, err := qualityfs.Put(qualityfs.Open(qualityReadDir(opts.dir)), record)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(out, "Recorded human label %s for %s/%s (feedback %s)\n", opts.verdict, experimentID, opts.caseID, saved.ID)
	return err
}

func labelRating(verdict string) (int, error) {
	switch verdict {
	case "pass":
		return 1, nil
	case "fail":
		return -1, nil
	default:
		return 0, fmt.Errorf("verdict must be pass or fail")
	}
}

func stringPtr(value string) *string {
	return &value
}

func intPtr(value int) *int {
	return &value
}
