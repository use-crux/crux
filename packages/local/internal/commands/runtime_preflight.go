package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/output"
)

type runtimePreflightManifest struct {
	Targets []runtimeManifestTarget `json:"targets"`
}

type runtimePreflightStatus struct {
	Counts []struct {
		Status   string `json:"status"`
		TargetID string `json:"targetId"`
		Count    int    `json:"count"`
	} `json:"counts"`
}

type runtimePreflightSetup struct {
	OK    bool `json:"ok"`
	Setup struct {
		Findings []struct {
			Code        string `json:"code"`
			Resource    string `json:"resource"`
			Message     string `json:"message"`
			Remediation string `json:"remediation,omitempty"`
		} `json:"findings"`
	} `json:"setup"`
}

func printRuntimeGeneratePreflight(io *output.IO, root string, generated json.RawMessage) {
	var result struct {
		Manifest runtimePreflightManifest `json:"manifest"`
	}
	if err := json.Unmarshal(generated, &result); err != nil {
		fmt.Fprintf(io.Out, "%s Runtime preflight skipped: %v\n", io.Sprint(output.Yellow, "warn"), err)
		return
	}
	printRuntimePreflight(io, root, &result.Manifest)
}

func printRuntimeDevPreflight(ctx context.Context) {
	root, err := resolveRuntimeGenerateRoot("")
	if err != nil {
		return
	}
	manifest, err := readRuntimePreflightManifest(root)
	if err != nil {
		return
	}
	printRuntimePreflight(output.NewIO(false), root, manifest)
}

func printRuntimePreflight(io *output.IO, root string, manifest *runtimePreflightManifest) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	setupRaw, err := runRuntimeOperationForCommand(ctx, root, "setup-check", "")
	if err != nil {
		printRuntimePreflightError(io, "setup", err)
		return
	}
	var setup runtimePreflightSetup
	if err := json.Unmarshal(setupRaw, &setup); err != nil {
		printRuntimePreflightError(io, "setup", err)
		return
	}
	if !setup.OK {
		fmt.Fprintf(io.Out, "%s Runtime setup needs attention\n", io.Sprint(output.Yellow, "warn"))
		for _, finding := range setup.Setup.Findings {
			fmt.Fprintf(io.Out, "  %s %s: %s\n", io.Sprint(output.Dim, finding.Code), finding.Resource, finding.Message)
			if finding.Remediation != "" {
				fmt.Fprintf(io.Out, "    %s %s\n", io.Sprint(output.Dim, "fix:"), finding.Remediation)
			}
		}
		return
	}

	statusRaw, err := runRuntimeOperationForCommand(ctx, root, "status", "")
	if err != nil {
		printRuntimePreflightError(io, "status", err)
		return
	}
	var status runtimePreflightStatus
	if err := json.Unmarshal(statusRaw, &status); err != nil {
		printRuntimePreflightError(io, "status", err)
		return
	}
	missing := missingRuntimePreflightTargets(manifest, status)
	if len(missing) == 0 {
		fmt.Fprintf(io.Out, "%s Runtime preflight passed\n", io.Sprint(output.Green, "OK"))
		return
	}
	fmt.Fprintf(io.Out, "%s Runtime artifacts are stale\n", io.Sprint(output.Yellow, "warn"))
	for _, item := range missing {
		fmt.Fprintf(io.Out, "  %s %s has %d non-terminal work item(s)\n", io.Sprint(output.Dim, "missing:"), item.targetID, item.count)
	}
	fmt.Fprintf(io.Out, "  %s Run `crux runtime generate` after restoring or renaming the target.\n", io.Sprint(output.Dim, "fix:"))
}

func printRuntimePreflightError(io *output.IO, phase string, err error) {
	if strings.Contains(err.Error(), "Code: RUNTIME_REQUIRED") {
		return
	}
	fmt.Fprintf(io.Out, "%s Runtime preflight %s failed\n", io.Sprint(output.Yellow, "warn"), phase)
	fmt.Fprintf(io.Out, "  %s\n", strings.ReplaceAll(err.Error(), "\n", "\n  "))
}

func readRuntimePreflightManifest(root string) (*runtimePreflightManifest, error) {
	raw, err := os.ReadFile(filepath.Join(root, ".crux/generated/runtime/manifest.json"))
	if err != nil {
		return nil, err
	}
	var manifest runtimePreflightManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return nil, err
	}
	return &manifest, nil
}

func missingRuntimePreflightTargets(
	manifest *runtimePreflightManifest,
	status runtimePreflightStatus,
) []struct {
	targetID string
	count    int
} {
	if manifest == nil {
		return nil
	}
	known := map[string]struct{}{}
	for _, target := range manifest.Targets {
		known[target.Name] = struct{}{}
	}
	counts := map[string]int{}
	for _, count := range status.Counts {
		if isTerminalRuntimeStatus(count.Status) {
			continue
		}
		if _, ok := known[count.TargetID]; ok {
			continue
		}
		counts[count.TargetID] += count.Count
	}
	missing := make([]struct {
		targetID string
		count    int
	}, 0, len(counts))
	for targetID, count := range counts {
		missing = append(missing, struct {
			targetID string
			count    int
		}{targetID: targetID, count: count})
	}
	sort.Slice(missing, func(i, j int) bool {
		return missing[i].targetID < missing[j].targetID
	})
	return missing
}

func isTerminalRuntimeStatus(status string) bool {
	return status == "completed" || status == "cancelled" || status == "blocked" || status == "dead-letter"
}
