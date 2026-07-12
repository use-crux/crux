package commands

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
)

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
			if !startupDebugEnabled(false) {
				slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
			}
			root, err := resolveRuntimeGenerateRoot(cwd)
			if err != nil {
				return err
			}
			operation := "project-setup-check"
			if apply {
				operation = "project-setup-apply"
			}
			raw, err := runRuntimeOperationForCommand(cmd.Context(), root, operation, "")
			if err != nil {
				return err
			}
			if jsonOutput {
				return writePrettyJSON(cmd.OutOrStdout(), raw)
			}
			return printSetupResult(f.Streams(), raw)
		},
	}
	cmd.Flags().BoolVar(&check, "check", false, "Check setup without mutating")
	cmd.Flags().BoolVar(&apply, "apply", false, "Apply safe additive actions and re-check")
	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output result as JSON")
	cmd.Flags().StringVar(&cwd, "cwd", "", "Project root to inspect")
	return cmd
}

func printSetupResult(streams *output.IO, raw json.RawMessage) error {
	var report struct {
		OK       bool `json:"ok"`
		Findings []struct {
			Code        string `json:"code"`
			Resource    string `json:"resource"`
			Message     string `json:"message"`
			Remediation string `json:"remediation"`
		} `json:"findings"`
	}
	if err := json.Unmarshal(raw, &report); err != nil {
		return fmt.Errorf("decode setup result: %w", err)
	}
	for _, finding := range report.Findings {
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
