package qualitycmd

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/quality"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type qualityJudgeReportOpts struct {
	dir     string
	jsonOut bool
}

// NewQualityJudgeReportCmd creates `crux quality judge-report <evaluation-id>`.
func NewQualityJudgeReportCmd(f *cli.Factory) *cobra.Command {
	opts := &qualityJudgeReportOpts{}
	cmd := &cobra.Command{
		Use:          "judge-report <evaluation-id>",
		Short:        "Compare judge scores with human labels",
		Args:         cobra.ExactArgs(1),
		SilenceUsage: true,
		Example:      "  crux quality judge-report support.refunds --json",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runQualityJudgeReport(cmd.Context(), cmd.OutOrStdout(), args[0], *opts)
		},
	}
	cmd.Flags().StringVar(&opts.dir, "dir", "", "Quality persistence root (default: <project root>/.crux/quality)")
	cmd.Flags().BoolVar(&opts.jsonOut, "json", false, "Print the judge report as JSON")
	return cmd
}

func runQualityJudgeReport(ctx context.Context, out io.Writer, evaluationID string, opts qualityJudgeReportOpts) error {
	report, found, err := quality.NewService(store.NewStore(), qualityReadDir(opts.dir)).JudgeReportAPI(ctx, evaluationID)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("evaluation %s not found", evaluationID)
	}
	if !opts.jsonOut {
		return fmt.Errorf("judge-report currently requires --json")
	}
	enc := json.NewEncoder(out)
	return enc.Encode(report)
}
