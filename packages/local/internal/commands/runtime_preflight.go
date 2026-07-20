package commands

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectindex/eventwire"
	"github.com/use-crux/crux/packages/local/internal/startup"
)

type runtimePreflightResult struct {
	OK    bool `json:"ok"`
	Setup struct {
		OK       bool `json:"ok"`
		Findings []struct {
			Code        string `json:"code"`
			Resource    string `json:"resource"`
			Message     string `json:"message"`
			Remediation string `json:"remediation,omitempty"`
		} `json:"findings"`
	} `json:"setup"`
	MissingTargets []struct {
		TargetID string `json:"targetId"`
		Count    int    `json:"count"`
	} `json:"missingTargets"`
}

func printRuntimeGeneratePreflight(ctx context.Context, io *output.IO, root string, generated json.RawMessage) {
	var generationResult struct{}
	if err := json.Unmarshal(generated, &generationResult); err != nil {
		fmt.Fprintf(io.Out, "%s Runtime preflight skipped: %v\n", io.Sprint(output.Yellow, "warn"), err)
		return
	}
	printRuntimePreflight(ctx, io, io.Out, root)
}

func printRuntimeDevPreflight(ctx context.Context, io *output.IO) []startup.Diagnostic {
	root, err := resolveRuntimeGenerateRoot("")
	if err != nil {
		return nil
	}
	return printRuntimePreflight(ctx, io, io.Err, root)
}

func printRuntimePreflight(parent context.Context, io *output.IO, writer io.Writer, root string) []startup.Diagnostic {
	ctx, cancel := context.WithTimeout(parent, 20*time.Second)
	defer cancel()

	raw, err := runRuntimeOperationForCommand(ctx, root, "preflight", "", newWorkerProcess(io.Err, startupDebugEnabled(false)))
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return nil
		}
		printRuntimePreflightError(io, writer, "preflight", err)
		return runtimePreflightErrorDiagnostics(err)
	}
	var result runtimePreflightResult
	if err := json.Unmarshal(raw, &result); err != nil {
		printRuntimePreflightError(io, writer, "preflight", err)
		return runtimePreflightErrorDiagnostics(err)
	}
	diagnostics := make([]startup.Diagnostic, 0, len(result.Setup.Findings)+len(result.MissingTargets))
	if !result.Setup.OK {
		fmt.Fprintf(writer, "%s Runtime setup needs attention\n", io.Sprint(output.Yellow, "warn"))
		for _, finding := range result.Setup.Findings {
			diagnostics = append(diagnostics, runtimeSetupFindingDiagnostic(finding.Code, finding.Resource, finding.Message, finding.Remediation))
			fmt.Fprintf(writer, "  %s %s: %s\n", io.Sprint(output.Dim, finding.Code), finding.Resource, finding.Message)
			if finding.Remediation != "" {
				fmt.Fprintf(writer, "    %s %s\n", io.Sprint(output.Dim, "fix:"), finding.Remediation)
			}
		}
		return diagnostics
	}

	for _, finding := range result.Setup.Findings {
		diagnostics = append(diagnostics, runtimeSetupFindingDiagnostic(finding.Code, finding.Resource, finding.Message, finding.Remediation))
		fmt.Fprintf(writer, "%s %s %s: %s\n", io.Sprint(output.Yellow, "warn"), io.Sprint(output.Dim, finding.Code), finding.Resource, finding.Message)
		if finding.Remediation != "" {
			fmt.Fprintf(writer, "  %s %s\n", io.Sprint(output.Dim, "fix:"), finding.Remediation)
		}
	}

	if len(result.MissingTargets) == 0 {
		fmt.Fprintf(writer, "%s Runtime preflight passed\n", io.Sprint(output.Green, "OK"))
		return diagnostics
	}
	fmt.Fprintf(writer, "%s Runtime artifacts are stale\n", io.Sprint(output.Yellow, "warn"))
	for _, item := range result.MissingTargets {
		diagnostics = append(diagnostics, startup.Diagnostic{
			ID: "runtime-preflight:missing-target:" + item.TargetID, Code: "RUNTIME_TARGET_MISSING", Severity: "warning",
			Message:     fmt.Sprintf("%s has %d non-terminal work item(s)", item.TargetID, item.Count),
			Remediation: "Run `crux runtime generate` after restoring or renaming the target.",
		})
		fmt.Fprintf(writer, "  %s %s has %d non-terminal work item(s)\n", io.Sprint(output.Dim, "missing:"), item.TargetID, item.Count)
	}
	fmt.Fprintf(writer, "  %s Run `crux runtime generate` after restoring or renaming the target.\n", io.Sprint(output.Dim, "fix:"))
	return diagnostics
}

func runtimeSetupFindingDiagnostic(code, resource, message, remediation string) startup.Diagnostic {
	return startup.Diagnostic{
		ID: "runtime-preflight:" + code + ":" + resource, Code: code, Severity: "warning",
		Message: strings.TrimSpace(resource + ": " + message), Remediation: remediation,
	}
}

func runtimePreflightErrorDiagnostics(err error) []startup.Diagnostic {
	if err == nil || errors.Is(err, context.Canceled) {
		return nil
	}
	diagnostic := startup.Diagnostic{
		ID: "runtime-preflight:failed", Code: "RUNTIME_PREFLIGHT_FAILED", Severity: "warning",
		Message: err.Error(), Remediation: "Fix the runtime configuration and rerun `crux dev`.",
	}
	var workerErr *eventwire.WorkerEventError
	if errors.As(err, &workerErr) {
		if workerErr.Code == "RUNTIME_REQUIRED" {
			return nil
		}
		if workerErr.Code != "" {
			diagnostic.ID = "runtime-preflight:" + workerErr.Code
			diagnostic.Code = workerErr.Code
		}
		if workerErr.Message != "" {
			diagnostic.Message = workerErr.Message
		}
		if workerErr.Remediation != "" {
			diagnostic.Remediation = workerErr.Remediation
		}
	}
	return []startup.Diagnostic{diagnostic}
}

func printRuntimePreflightError(io *output.IO, writer io.Writer, phase string, err error) {
	if strings.Contains(err.Error(), "Code: RUNTIME_REQUIRED") {
		return
	}
	fmt.Fprintf(writer, "%s Runtime preflight %s failed\n", io.Sprint(output.Yellow, "warn"), phase)
	fmt.Fprintf(writer, "  %s\n", strings.ReplaceAll(err.Error(), "\n", "\n  "))
}
