package qualitycmd

import (
	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
)

// New is the Quality command group (spec 03 §1):
// run/watch/list/show/promote over the Quality engine. The pre-rewrite
// positional workbench sections (overview/suites/experiments/...) were
// deleted with the legacy read models; devtools is the workbench surface.
func New(f *cli.Factory) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "quality",
		Short: "Run source-defined evaluations and inspect experiments",
		Long: `Quality is the canonical Crux evaluation surface.

Source-defined evaluate(...) checks are discovered as evaluations. Running
them writes immutable Experiment records under .crux/quality. Use those
records for progress, baselines, and cell-level debugging evidence.`,
		Example: `  crux quality list
  crux quality run
  crux quality run memory.contracts --case "*ids*"
  crux quality show <experiment-id> --json
  crux quality progress <evaluation-id>
  crux quality cell-evidence <experiment-id> --case <case-id> --variant default --trial 0 --json
  crux quality promote <experiment-id>`,
	}
	cmd.AddCommand(
		NewQualityRunCmd(f),
		NewQualityWatchCmd(f),
		NewQualityListCmd(),
		NewQualityShowCmd(f),
		NewQualityProgressCmd(f),
		NewQualityCellEvidenceCmd(f),
		NewQualityDiffCmd(f),
		NewQualityLabelCmd(f),
		NewQualityJudgeReportCmd(f),
		NewQualityPromoteCmd(f),
	)
	return cmd
}
