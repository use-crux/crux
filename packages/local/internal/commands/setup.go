package commands

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"strings"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectindex/eventwire"
)

type setupCommandResult struct {
	OK         bool            `json:"ok"`
	Setup      setupReport     `json:"setup"`
	Generation setupGeneration `json:"generation"`
}

type setupReport struct {
	OK       bool           `json:"ok"`
	Mode     string         `json:"mode"`
	Findings []setupFinding `json:"findings"`
	Actions  []setupAction  `json:"actions"`
	Applied  []setupApplied `json:"applied"`
}

type setupFinding struct {
	ContributorID string `json:"contributorId"`
	Code          string `json:"code"`
	Resource      string `json:"resource"`
	Severity      string `json:"severity"`
	Message       string `json:"message"`
	DocsURL       string `json:"docsUrl,omitempty"`
	Remediation   string `json:"remediation,omitempty"`
	AgentPrompt   string `json:"agentPrompt,omitempty"`
}

type setupAction struct {
	ID             string `json:"id"`
	ContributorID  string `json:"contributorId"`
	Classification string `json:"classification"`
	Title          string `json:"title"`
	Description    string `json:"description"`
	Remediation    string `json:"remediation,omitempty"`
}

type setupApplied struct {
	OK       bool           `json:"ok"`
	ActionID string         `json:"actionId"`
	Findings []setupFinding `json:"findings"`
}

type setupGeneration struct {
	Status       string                             `json:"status"`
	ContentHash  string                             `json:"contentHash,omitempty"`
	PendingFiles []string                           `json:"pendingFiles"`
	ChangedFiles []string                           `json:"changedFiles"`
	Findings     []eventwire.RuntimeArtifactFinding `json:"findings"`
}

// NewSetupCmd creates the root project setup command.
func NewSetupCmd(f *cli.Factory) *cobra.Command {
	var check, apply, jsonOutput bool
	var cwd string
	cmd := &cobra.Command{
		Use: "setup", Short: "Check or safely apply project setup", Args: cobra.NoArgs,
		Long: "Check project setup and generated Runtime files by default. Use --apply to safely apply additive setup and refresh generated files.",
		RunE: func(cmd *cobra.Command, _ []string) error {
			if check && apply {
				return fmt.Errorf("choose at most one of --check or --apply")
			}
			return runSetupCommand(cmd, f, cwd, jsonOutput, apply)
		},
	}
	cmd.Flags().BoolVar(&check, "check", false, "Check setup and generated files without mutating")
	cmd.Flags().BoolVar(&apply, "apply", false, "Apply safe additive actions and refresh generated files")
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
	result, err := decodeSetupCommandResult(raw)
	if err != nil {
		return err
	}
	if jsonOutput {
		err = writePrettyJSON(streams.Out, raw)
	} else {
		err = printSetupResult(streams, result)
	}
	if err != nil {
		return err
	}
	if !result.OK {
		cmd.Root().SilenceErrors = true
		cmd.Root().SilenceUsage = true
		return domain.ExitError{Code: 1}
	}
	return nil
}

func decodeSetupCommandResult(raw json.RawMessage) (setupCommandResult, error) {
	var result setupCommandResult
	if err := decodeStrictJSON(raw, &result); err != nil {
		return setupCommandResult{}, fmt.Errorf("decode setup result: %w", err)
	}
	if err := validateSetupReport(result.Setup); err != nil {
		return setupCommandResult{}, fmt.Errorf("decode setup result: %w", err)
	}
	if err := validateSetupGeneration(result); err != nil {
		return setupCommandResult{}, fmt.Errorf("decode setup result: %w", err)
	}
	return result, nil
}

func decodeSetupPlanningReport(raw json.RawMessage) (setupReport, error) {
	var report setupReport
	if err := decodeStrictJSON(raw, &report); err != nil {
		return setupReport{}, fmt.Errorf("decode setup planning result: %w", err)
	}
	if err := validateSetupReport(report); err != nil {
		return setupReport{}, fmt.Errorf("decode setup planning result: %w", err)
	}
	return report, nil
}

func decodeStrictJSON(raw json.RawMessage, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		if err == nil {
			return fmt.Errorf("unexpected trailing JSON value")
		}
		return err
	}
	return nil
}

func validateSetupReport(report setupReport) error {
	if report.Mode != "check" && report.Mode != "apply" {
		return fmt.Errorf("setup.mode = %q, want check or apply", report.Mode)
	}
	if report.Findings == nil || report.Actions == nil || report.Applied == nil {
		return fmt.Errorf("setup findings, actions, and applied arrays are required")
	}
	hasError := false
	for index, finding := range report.Findings {
		if finding.ContributorID == "" || finding.Code == "" || finding.Resource == "" || finding.Message == "" {
			return fmt.Errorf("setup finding %d is missing required context", index)
		}
		switch finding.Severity {
		case "error":
			hasError = true
		case "warning", "info":
		default:
			return fmt.Errorf("setup finding %d has unknown severity %q", index, finding.Severity)
		}
	}
	if report.OK == hasError {
		return fmt.Errorf("setup.ok does not match final error findings")
	}
	return nil
}

func validateSetupGeneration(result setupCommandResult) error {
	generation := result.Generation
	if generation.PendingFiles == nil || generation.ChangedFiles == nil || generation.Findings == nil {
		return fmt.Errorf("generation pendingFiles, changedFiles, and findings arrays are required")
	}
	for _, file := range append(append([]string{}, generation.PendingFiles...), generation.ChangedFiles...) {
		if !validSetupPath(file) {
			return fmt.Errorf("generation path %q is not root-relative POSIX", file)
		}
	}
	for index, finding := range generation.Findings {
		if err := eventwire.ValidateRuntimeArtifactFinding(finding); err != nil {
			return fmt.Errorf("generation finding %d: %w", index, err)
		}
	}
	validHash := len(generation.ContentHash) == 64 && strings.IndexFunc(generation.ContentHash, func(r rune) bool {
		return (r < '0' || r > '9') && (r < 'a' || r > 'f')
	}) == -1
	switch generation.Status {
	case "current":
		if !validHash || len(generation.PendingFiles) != 0 || len(generation.ChangedFiles) != 0 || len(generation.Findings) != 0 || !result.OK || !result.Setup.OK {
			return fmt.Errorf("invalid current generation result")
		}
	case "would-generate":
		if result.Setup.Mode != "check" || !validHash || len(generation.PendingFiles) == 0 || len(generation.ChangedFiles) != 0 || len(generation.Findings) != 0 || result.OK || !result.Setup.OK {
			return fmt.Errorf("invalid would-generate result")
		}
	case "generated":
		if result.Setup.Mode != "apply" || !validHash || len(generation.PendingFiles) != 0 || len(generation.ChangedFiles) == 0 || len(generation.Findings) != 0 || !result.OK || !result.Setup.OK {
			return fmt.Errorf("invalid generated result")
		}
	case "blocked":
		if generation.ContentHash != "" || len(generation.PendingFiles) != 0 || len(generation.ChangedFiles) != 0 || len(generation.Findings) != 0 || result.OK || result.Setup.OK {
			return fmt.Errorf("invalid blocked generation result")
		}
	case "failed":
		if len(generation.Findings) == 0 || result.OK || result.Setup.OK {
			return fmt.Errorf("invalid failed generation result")
		}
		if generation.ContentHash != "" && !validHash {
			return fmt.Errorf("generation contentHash is invalid")
		}
	default:
		return fmt.Errorf("unknown generation status %q", generation.Status)
	}
	if result.Setup.Mode == "check" && generation.Status == "generated" {
		return fmt.Errorf("check mode cannot return generated")
	}
	if result.Setup.Mode == "apply" && generation.Status == "would-generate" {
		return fmt.Errorf("apply mode cannot return would-generate")
	}
	return nil
}

func validSetupPath(file string) bool {
	return file != "" && !strings.Contains(file, "\\") && !strings.HasPrefix(file, "/") && file != ".." && !strings.HasPrefix(file, "../") && path.Clean(file) == file
}

func printSetupResult(streams *output.IO, result setupCommandResult) error {
	lastContributor := ""
	for _, finding := range result.Setup.Findings {
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
	if len(result.Setup.Findings) > 0 {
		fmt.Fprintln(streams.Out)
	}
	printSetupGeneration(streams, result.Generation)
	if result.OK {
		fmt.Fprintln(streams.Out, "Setup ok")
	} else {
		fmt.Fprintln(streams.Out, "Setup needs attention")
	}
	return nil
}

func printSetupGeneration(streams *output.IO, generation setupGeneration) {
	switch generation.Status {
	case "current":
		fmt.Fprintln(streams.Out, "Runtime files are current")
	case "would-generate":
		fmt.Fprintf(streams.Out, "Runtime files need a refresh (%d files)\n", len(generation.PendingFiles))
		for _, file := range generation.PendingFiles {
			fmt.Fprintf(streams.Out, "  pending: %s\n", file)
		}
	case "generated":
		fmt.Fprintf(streams.Out, "Runtime files refreshed (%d files)\n", len(generation.ChangedFiles))
		for _, file := range generation.ChangedFiles {
			fmt.Fprintf(streams.Out, "  wrote: %s\n", file)
		}
	case "blocked":
		fmt.Fprintln(streams.Out, "Runtime files were not changed because setup needs attention")
	case "failed":
		label := "issues"
		if len(generation.Findings) == 1 {
			label = "issue"
		}
		fmt.Fprintf(streams.Out, "Runtime files could not be prepared (%d %s)\n", len(generation.Findings), label)
		limit := min(5, len(generation.Findings))
		for index := 0; index < limit; index++ {
			finding := generation.Findings[index]
			fmt.Fprintf(streams.Out, "  %d. [%s] %s\n", index+1, finding.Code, finding.Summary)
			fmt.Fprintf(streams.Out, "     Why: %s\n", finding.Reason)
			if finding.Remediation != "" {
				fmt.Fprintf(streams.Out, "     Fix: %s\n", finding.Remediation)
			}
		}
		if remaining := len(generation.Findings) - limit; remaining > 0 {
			fmt.Fprintf(streams.Out, "  ... and %d more.\n", remaining)
		}
	}
}
