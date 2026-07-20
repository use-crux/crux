package commands

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectindex/eventwire"
)

func TestRuntimeGenerateJSONPreservesEveryFinding(t *testing.T) {
	previous := generateRuntimeArtifactsForCommand
	t.Cleanup(func() { generateRuntimeArtifactsForCommand = previous })
	generateRuntimeArtifactsForCommand = func(context.Context, string, commandWorkerProcess) (json.RawMessage, error) {
		return nil, &eventwire.WorkerEventError{
			Scope: "artifact", Code: "RUNTIME_ARTIFACT_GENERATION_FAILED", Message: "two issues",
			Findings: []eventwire.RuntimeArtifactFinding{
				{Code: "RUNTIME_EVAL_INVALID", Category: "authored", Summary: "Eval is not ready.", Reason: "Task is not callable."},
				{Code: "TARGET_NOT_EXPORTED", Category: "authored", Summary: "Target is not exported.", Reason: "Named export is missing."},
			},
		}
	}

	var out, errOut strings.Builder
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
	cmd := NewRuntimeCmd(cli.NewFactoryWithStreams(streams))
	cmd.SetArgs([]string{"--json", "--cwd", t.TempDir(), "generate"})
	err := cmd.Execute()
	var exitErr domain.ExitError
	if !errors.As(err, &exitErr) || exitErr.Code != 1 {
		t.Fatalf("error = %T %v, want exit 1", err, err)
	}

	var payload struct {
		OK    bool `json:"ok"`
		Error struct {
			Code     string                             `json:"code"`
			Message  string                             `json:"message"`
			Findings []eventwire.RuntimeArtifactFinding `json:"findings"`
		} `json:"error"`
	}
	if err := json.Unmarshal([]byte(out.String()), &payload); err != nil {
		t.Fatalf("decode JSON error output: %v\n%s", err, out.String())
	}
	if payload.OK || payload.Error.Code != "RUNTIME_ARTIFACT_GENERATION_FAILED" || len(payload.Error.Findings) != 2 {
		t.Fatalf("payload = %#v, want aggregate and both findings", payload)
	}
	if strings.Contains(payload.Error.Message, "project index worker") {
		t.Fatalf("message = %q, want no worker plumbing", payload.Error.Message)
	}
	if errOut.Len() != 0 {
		t.Fatalf("stderr = %q, want machine-readable stdout only", errOut.String())
	}
}

func TestRuntimeGenerateHumanErrorHidesWorkerPlumbing(t *testing.T) {
	previous := generateRuntimeArtifactsForCommand
	t.Cleanup(func() { generateRuntimeArtifactsForCommand = previous })
	generateRuntimeArtifactsForCommand = func(context.Context, string, commandWorkerProcess) (json.RawMessage, error) {
		return nil, &eventwire.WorkerEventError{
			Scope:   "artifact",
			Code:    "RUNTIME_ARTIFACT_GENERATION_FAILED",
			Message: "Runtime artifacts could not be generated (1 issue).\n1. [TARGET_NOT_EXPORTED] Runtime target 'review' is not exported.",
			Findings: []eventwire.RuntimeArtifactFinding{{
				Code: "TARGET_NOT_EXPORTED", Category: "authored", Summary: "Runtime target 'review' is not exported.", Reason: "Named export is missing.",
			}},
		}
	}

	var out, errOut strings.Builder
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
	cmd := NewRuntimeCmd(cli.NewFactoryWithStreams(streams))
	cmd.SetArgs([]string{"--cwd", t.TempDir(), "generate"})
	err := cmd.Execute()
	var exitErr domain.ExitError
	if !errors.As(err, &exitErr) || exitErr.Code != 1 {
		t.Fatalf("error = %T %v, want exit 1", err, err)
	}
	if out.Len() != 0 {
		t.Fatalf("stdout = %q, want empty", out.String())
	}
	if !strings.Contains(errOut.String(), "Runtime artifacts could not be generated") || strings.Contains(errOut.String(), "project index worker artifact failed") {
		t.Fatalf("stderr = %q, want direct human finding without worker plumbing", errOut.String())
	}
}
