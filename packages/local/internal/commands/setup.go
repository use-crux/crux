package commands

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
)

type setupReport struct {
	OK       bool           `json:"ok"`
	Findings []setupFinding `json:"findings"`
}

type setupFinding struct {
	ContributorID string `json:"contributorId"`
	Code          string `json:"code"`
	Resource      string `json:"resource"`
	Message       string `json:"message"`
	Remediation   string `json:"remediation"`
}

// NewSetupCmd creates the root project setup command.
func NewSetupCmd(f *cli.Factory) *cobra.Command {
	var check, apply, jsonOutput bool
	var cwd string
	cmd := &cobra.Command{
		Use: "setup", Short: "Check or safely apply project setup", Args: cobra.NoArgs,
		Long: "Check project setup by default. Use --apply to apply safe additive actions only.",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if check && apply {
				return fmt.Errorf("choose at most one of --check or --apply")
			}
			return runSetupCommand(cmd, f, cwd, jsonOutput, apply)
		},
	}
	cmd.Flags().BoolVar(&check, "check", false, "Check setup without mutating")
	cmd.Flags().BoolVar(&apply, "apply", false, "Apply safe additive actions and re-check")
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output result as JSON")
	cmd.Flags().StringVar(&cwd, "cwd", "", "Project root to inspect")
	return cmd
}

func runSetupCommand(cmd *cobra.Command, f *cli.Factory, cwd string, jsonOutput, apply bool) error {
	streams := f.Streams()
	root, err := resolveRuntimeGenerateRoot(cwd)
	if err != nil {
		return err
	}
	mode := "check"
	if apply {
		mode = "apply"
	}
	raw, err := runSetupOperationForCommand(cmd.Context(), root, mode, newCommandWorkerProcess(streams))
	if err != nil {
		return err
	}
	report, err := decodeSetupReport(raw)
	if err != nil {
		return err
	}
	if jsonOutput {
		err = writePrettyJSON(streams.Out, raw)
	} else {
		err = printSetupResult(streams, report)
	}
	if err != nil {
		return err
	}
	if !report.OK {
		cmd.Root().SilenceErrors = true
		cmd.Root().SilenceUsage = true
		return domain.ExitError{Code: 1}
	}
	return nil
}

func decodeSetupReport(raw json.RawMessage) (setupReport, error) {
	var report setupReport
	if err := json.Unmarshal(raw, &report); err != nil {
		return setupReport{}, fmt.Errorf("decode setup result: %w", err)
	}
	return report, nil
}

func printSetupResult(streams *output.IO, report setupReport) error {
	lastContributor := ""
	for _, finding := range report.Findings {
		if finding.ContributorID != lastContributor {
			if lastContributor != "" {
				fmt.Fprintln(streams.Out)
			}
			fmt.Fprintln(streams.Out, streams.Sprint(output.Bold, finding.ContributorID))
			lastContributor = finding.ContributorID
		}
		fmt.Fprintf(streams.Out, "%s %s: %s\n", finding.Code, finding.Resource, finding.Message)
		if finding.Remediation != "" {
			fmt.Fprintf(streams.Out, "  fix: %s\n", finding.Remediation)
		}
	}
	if report.OK {
		fmt.Fprintln(streams.Out, "Setup ok")
	} else {
		fmt.Fprintln(streams.Out, "Setup needs attention")
	}
	return nil
}
