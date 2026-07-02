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

func newRuntimeSetupCmd(f *cli.Factory, opts *runtimeGenerateOptions) *cobra.Command {
	var check bool
	var apply bool
	cmd := &cobra.Command{
		Use:   "setup (--check | --apply)",
		Short: "Verify or apply Runtime Engine adapter setup",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if check == apply {
				return fmt.Errorf("choose exactly one of --check or --apply")
			}
			operation := "setup-check"
			if apply {
				operation = "setup-apply"
			}
			return runAndPrintRuntimeOperation(cmd, f, opts, operation, "")
		},
	}
	cmd.Flags().BoolVar(&check, "check", false, "Verify resources without mutating")
	cmd.Flags().BoolVar(&apply, "apply", false, "Apply safe additive setup")
	return cmd
}

func newRuntimeStatusCmd(f *cli.Factory, opts *runtimeGenerateOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "Show Runtime Engine work counts",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAndPrintRuntimeOperation(cmd, f, opts, "status", "")
		},
	}
}

func newRuntimeInspectCmd(f *cli.Factory, opts *runtimeGenerateOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "inspect <workId>",
		Short: "Inspect one Runtime Engine work item",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAndPrintRuntimeOperation(cmd, f, opts, "inspect", args[0])
		},
	}
}

func newRuntimeRetryCmd(f *cli.Factory, opts *runtimeGenerateOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "retry <workId>",
		Short: "Retry blocked or dead-lettered Runtime Engine work",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAndPrintRuntimeOperation(cmd, f, opts, "retry", args[0])
		},
	}
}

func newRuntimeCancelCmd(f *cli.Factory, opts *runtimeGenerateOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "cancel <workId>",
		Short: "Cancel non-terminal Runtime Engine work",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAndPrintRuntimeOperation(cmd, f, opts, "cancel", args[0])
		},
	}
}

func runAndPrintRuntimeOperation(cmd *cobra.Command, f *cli.Factory, opts *runtimeGenerateOptions, operation, workID string) error {
	if !startupDebugEnabled(false) {
		slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	}
	root, err := resolveRuntimeGenerateRoot(opts.cwd)
	if err != nil {
		return err
	}
	result, err := runRuntimeOperationForCommand(cmd.Context(), root, operation, workID)
	if err != nil {
		return err
	}
	if opts.jsonOutput {
		return writePrettyJSON(cmd.OutOrStdout(), result)
	}
	return printRuntimeOperationResult(f.Streams(), result)
}

func printRuntimeOperationResult(io *output.IO, raw json.RawMessage) error {
	var header struct {
		Operation string `json:"operation"`
		OK        bool   `json:"ok"`
	}
	if err := json.Unmarshal(raw, &header); err != nil {
		return fmt.Errorf("decode runtime operation result: %w", err)
	}
	switch header.Operation {
	case "setup-check", "setup-apply":
		return printRuntimeSetupResult(io, raw, header)
	case "status":
		return printRuntimeStatusResult(io, raw)
	case "inspect":
		return printRuntimeInspectResult(io, raw)
	case "retry":
		return printRuntimeRetryResult(io, raw)
	case "cancel":
		return printRuntimeCancelResult(io, raw)
	default:
		return writePrettyJSON(io.Out, raw)
	}
}

func printRuntimeSetupResult(io *output.IO, raw json.RawMessage, header struct {
	Operation string `json:"operation"`
	OK        bool   `json:"ok"`
}) error {
	var result struct {
		Setup struct {
			Findings []struct {
				Code        string `json:"code"`
				Resource    string `json:"resource"`
				Message     string `json:"message"`
				Remediation string `json:"remediation,omitempty"`
			} `json:"findings"`
		} `json:"setup"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Errorf("decode runtime setup result: %w", err)
	}
	status := io.Sprint(output.Green, "passed")
	if !header.OK {
		status = io.Sprint(output.Yellow, "needs setup")
	}
	fmt.Fprintf(io.Out, "Runtime %s %s\n", header.Operation, status)
	for _, finding := range result.Setup.Findings {
		fmt.Fprintf(io.Out, "%s %s: %s\n", io.Sprint(output.Dim, finding.Code), finding.Resource, finding.Message)
		if finding.Remediation != "" {
			fmt.Fprintf(io.Out, "  %s %s\n", io.Sprint(output.Dim, "fix:"), finding.Remediation)
		}
	}
	return nil
}

func printRuntimeStatusResult(io *output.IO, raw json.RawMessage) error {
	var result struct {
		Namespace string `json:"namespace"`
		Counts    []struct {
			Status   string `json:"status"`
			TargetID string `json:"targetId"`
			Count    int    `json:"count"`
		} `json:"counts"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Errorf("decode runtime status result: %w", err)
	}
	fmt.Fprintf(io.Out, "Runtime namespace %s\n", io.Sprint(output.Bold, result.Namespace))
	if len(result.Counts) == 0 {
		fmt.Fprintln(io.Out, "No runtime work found.")
		return nil
	}
	for _, count := range result.Counts {
		fmt.Fprintf(io.Out, "%-12s %-24s %d\n", count.Status, count.TargetID, count.Count)
	}
	return nil
}

func printRuntimeInspectResult(io *output.IO, raw json.RawMessage) error {
	var result struct {
		OK   bool `json:"ok"`
		Work *struct {
			WorkID      string `json:"workId"`
			Status      string `json:"status"`
			TargetID    string `json:"targetId"`
			Attempt     int    `json:"attempt"`
			MaxAttempts int    `json:"maxAttempts"`
			LastError   *struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"lastError,omitempty"`
		} `json:"work,omitempty"`
		Flow *struct {
			Fingerprint []string `json:"fingerprint"`
		} `json:"flow,omitempty"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Errorf("decode runtime inspect result: %w", err)
	}
	if !result.OK || result.Work == nil {
		fmt.Fprintln(io.Out, "Runtime work item not found.")
		return nil
	}
	fmt.Fprintf(io.Out, "%s %s\n", io.Sprint(output.Bold, "work:"), result.Work.WorkID)
	fmt.Fprintf(io.Out, "status: %s\n", result.Work.Status)
	fmt.Fprintf(io.Out, "target: %s\n", result.Work.TargetID)
	fmt.Fprintf(io.Out, "attempts: %d/%d\n", result.Work.Attempt, result.Work.MaxAttempts)
	if result.Work.LastError != nil {
		fmt.Fprintf(io.Out, "last error: %s %s\n", result.Work.LastError.Code, result.Work.LastError.Message)
	}
	if result.Flow != nil {
		fmt.Fprintf(io.Out, "fingerprint: %v\n", result.Flow.Fingerprint)
	}
	return nil
}

func printRuntimeRetryResult(io *output.IO, raw json.RawMessage) error {
	var result struct {
		Retried bool `json:"retried"`
		Work    *struct {
			WorkID string `json:"workId"`
			Status string `json:"status"`
		} `json:"work,omitempty"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Errorf("decode runtime retry result: %w", err)
	}
	if !result.Retried || result.Work == nil {
		fmt.Fprintln(io.Out, "Runtime work was not retryable.")
		return nil
	}
	fmt.Fprintf(io.Out, "Retried %s; status is %s\n", result.Work.WorkID, result.Work.Status)
	return nil
}

func printRuntimeCancelResult(io *output.IO, raw json.RawMessage) error {
	var result struct {
		Cancelled bool `json:"cancelled"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Errorf("decode runtime cancel result: %w", err)
	}
	if result.Cancelled {
		fmt.Fprintln(io.Out, "Runtime work cancelled.")
	} else {
		fmt.Fprintln(io.Out, "Runtime work was already terminal or missing.")
	}
	return nil
}
