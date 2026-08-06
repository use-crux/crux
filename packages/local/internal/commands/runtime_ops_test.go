package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectindex/eventwire"
)

func TestRuntimeOperationCommandsRouteToWorker(t *testing.T) {
	oldRunner := runRuntimeOperationForCommand
	defer func() { runRuntimeOperationForCommand = oldRunner }()

	root := t.TempDir()
	cases := []struct {
		name      string
		args      []string
		operation string
		workID    string
	}{
		{
			name:      "status",
			args:      []string{"--json", "--cwd", root, "status"},
			operation: "status",
		},
		{
			name:      "inspect",
			args:      []string{"--json", "--cwd", root, "inspect", "work_123"},
			operation: "inspect",
			workID:    "work_123",
		},
		{
			name:      "retry",
			args:      []string{"--json", "--cwd", root, "retry", "work_123"},
			operation: "retry",
			workID:    "work_123",
		},
		{
			name:      "cancel",
			args:      []string{"--json", "--cwd", root, "cancel", "work_123"},
			operation: "cancel",
			workID:    "work_123",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var out, errOut strings.Builder
			streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{})
			called := false
			runRuntimeOperationForCommand = func(_ context.Context, gotRoot, gotOperation, gotWorkID string, process commandWorkerProcess) (json.RawMessage, error) {
				called = true
				if process.stderr != streams.Err {
					t.Fatal("runtime worker stderr did not use the factory IO")
				}
				if gotRoot != root {
					t.Fatalf("root = %q, want %q", gotRoot, root)
				}
				if gotOperation != tc.operation {
					t.Fatalf("operation = %q, want %q", gotOperation, tc.operation)
				}
				if gotWorkID != tc.workID {
					t.Fatalf("workID = %q, want %q", gotWorkID, tc.workID)
				}
				return json.RawMessage(`{"operation":"` + tc.operation + `","ok":true}`), nil
			}

			cmd := NewRuntimeCmd(cli.NewFactoryWithStreams(streams))
			cmd.SetArgs(tc.args)

			if err := cmd.Execute(); err != nil {
				t.Fatalf("crux runtime %s error: %v\nstderr:\n%s", tc.name, err, errOut.String())
			}
			if !called {
				t.Fatal("runtime operation runner was not called")
			}
			if strings.Contains(out.String(), "\x1b[") {
				t.Fatalf("JSON output contains ANSI styling: %q", out.String())
			}
			var decoded struct {
				Operation string `json:"operation"`
				OK        bool   `json:"ok"`
			}
			if err := json.Unmarshal([]byte(out.String()), &decoded); err != nil {
				t.Fatalf("decode JSON: %v\n%s", err, out.String())
			}
			if decoded.Operation != tc.operation || !decoded.OK {
				t.Fatalf("decoded output = %#v, want operation %q and ok", decoded, tc.operation)
			}
		})
	}
}

func TestRuntimeSetupIsNotACommand(t *testing.T) {
	cmd := NewRuntimeCmd(&cli.Factory{})
	cmd.SetArgs([]string{"setup"})

	err := cmd.Execute()
	if err == nil {
		t.Fatal("crux runtime setup unexpectedly succeeded")
	}
	if !strings.Contains(err.Error(), "unknown command") {
		t.Fatalf("error = %q, want unknown command", err.Error())
	}
}

func TestRuntimeWorkerCommandRunsOneSupervisedProcess(t *testing.T) {
	previous := runRuntimeWorkerForCommand
	t.Cleanup(func() { runRuntimeWorkerForCommand = previous })
	root := t.TempDir()
	called := 0
	runRuntimeWorkerForCommand = func(_ context.Context, gotRoot string, process commandWorkerProcess) error {
		called++
		if gotRoot != root {
			t.Fatalf("root = %q, want %q", gotRoot, root)
		}
		if process.stderr == nil {
			t.Fatal("worker diagnostic stream is nil")
		}
		return nil
	}

	cmd := NewRuntimeCmd(cli.NewFactoryWithStreams(output.NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, output.TestIOOptions{})))
	cmd.SetArgs([]string{"--cwd", root, "worker"})
	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatal(err)
	}
	if called != 1 {
		t.Fatalf("worker starts = %d, want 1", called)
	}
}

func TestRuntimeStatusPrintsTruncatedCountMarkers(t *testing.T) {
	var out, errOut bytes.Buffer
	io := output.NewTestIO(&out, &errOut, output.TestIOOptions{ColorEnabled: false})

	err := printRuntimeStatusResult(io, json.RawMessage(`{
	  "operation": "status",
	  "ok": true,
	  "namespace": "local",
	  "counts": [
	    { "status": "pending", "targetId": "review", "count": 2000, "truncated": true },
	    { "status": "blocked", "targetId": "review", "count": 1 }
	  ]
	}`))
	if err != nil {
		t.Fatalf("print runtime status: %v", err)
	}
	text := out.String()
	if !strings.Contains(text, "2000+") {
		t.Fatalf("truncated marker missing from status output:\n%s", text)
	}
	if !strings.Contains(text, "blocked") || !strings.Contains(text, "1") {
		t.Fatalf("exact count missing from status output:\n%s", text)
	}
}

func TestRuntimeStatusLeadsWithRuntimeRequiredDiagnostic(t *testing.T) {
	oldRunner := runRuntimeOperationForCommand
	t.Cleanup(func() { runRuntimeOperationForCommand = oldRunner })
	runRuntimeOperationForCommand = func(context.Context, string, string, string, commandWorkerProcess) (json.RawMessage, error) {
		return nil, &eventwire.WorkerEventError{
			Scope:   "artifact",
			Code:    "RUNTIME_REQUIRED",
			Message: "crux runtime requires a Crux runtime engine.\n\nWhy: durable work needs a configured engine.\nCode: RUNTIME_REQUIRED",
		}
	}

	cmd := NewRuntimeCmd(cli.NewFactoryWithStreams(
		output.NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, output.TestIOOptions{}),
	))
	cmd.SetArgs([]string{"--cwd", t.TempDir(), "status"})
	err := cmd.Execute()
	if err == nil {
		t.Fatal("runtime status unexpectedly succeeded")
	}
	if !strings.HasPrefix(err.Error(), "crux runtime requires a Crux runtime engine.") {
		t.Fatalf("error = %q, want Runtime diagnostic first", err)
	}
	if strings.Contains(err.Error(), "project index worker artifact failed") {
		t.Fatalf("error retained worker wrapper: %q", err)
	}
	var workerErr *eventwire.WorkerEventError
	if errors.As(err, &workerErr) {
		t.Fatalf("error still exposes worker transport type: %T", err)
	}
}

func TestRuntimeGeneratePreflightReportsMissingNonTerminalTargets(t *testing.T) {
	oldRunner := runRuntimeOperationForCommand
	defer func() { runRuntimeOperationForCommand = oldRunner }()

	runRuntimeOperationForCommand = func(_ context.Context, _, operation, _ string, _ commandWorkerProcess) (json.RawMessage, error) {
		switch operation {
		case "preflight":
			return json.RawMessage(`{
			  "operation": "preflight",
			  "ok": false,
			  "setup": { "ok": true, "findings": [] },
			  "missingTargets": [
			    { "targetId": "old-review", "count": 2 }
			  ]
			}`), nil
		default:
			t.Fatalf("unexpected operation %q", operation)
			return nil, nil
		}
	}

	var out, errOut bytes.Buffer
	io := output.NewTestIO(&out, &errOut, output.TestIOOptions{ColorEnabled: false})
	printRuntimeGeneratePreflight(context.Background(), io, t.TempDir(), json.RawMessage(`{
	  "manifest": { "targets": [{ "name": "review", "kind": "flow" }] }
	}`))

	text := out.String()
	if !strings.Contains(text, "Runtime artifacts are stale") {
		t.Fatalf("preflight output missing stale warning:\n%s", text)
	}
	if !strings.Contains(text, "old-review has 2 non-terminal work item(s)") {
		t.Fatalf("preflight output missing old target count:\n%s", text)
	}
	if strings.Contains(text, "blocked-old-review") {
		t.Fatalf("preflight reported terminal blocked work:\n%s", text)
	}
}

func TestRuntimeGeneratePreflightRendersPassingSetupWarnings(t *testing.T) {
	oldRunner := runRuntimeOperationForCommand
	defer func() { runRuntimeOperationForCommand = oldRunner }()

	runRuntimeOperationForCommand = func(_ context.Context, _, operation, _ string, _ commandWorkerProcess) (json.RawMessage, error) {
		switch operation {
		case "preflight":
			return json.RawMessage(`{
			  "operation": "preflight",
			  "ok": true,
			  "setup": {
			    "ok": true,
			    "findings": [
			      {
			        "code": "NAMESPACE_AMBIGUOUS",
			        "resource": "serverless:generic-queue",
			        "message": "namespace resolved to local by fallback",
			        "remediation": "Set CRUX_RUNTIME_NAMESPACE or pass namespace to the runtime composer."
			      }
			    ]
			  },
			  "missingTargets": []
			}`), nil
		default:
			t.Fatalf("unexpected operation %q", operation)
			return nil, nil
		}
	}

	var out, errOut bytes.Buffer
	io := output.NewTestIO(&out, &errOut, output.TestIOOptions{ColorEnabled: false})
	printRuntimeGeneratePreflight(context.Background(), io, t.TempDir(), json.RawMessage(`{
	  "manifest": { "targets": [] }
	}`))

	text := out.String()
	if !strings.Contains(text, "NAMESPACE_AMBIGUOUS") {
		t.Fatalf("preflight output missing namespace warning:\n%s", text)
	}
	if !strings.Contains(text, "Set CRUX_RUNTIME_NAMESPACE") {
		t.Fatalf("preflight output missing namespace remediation:\n%s", text)
	}
	if !strings.Contains(text, "Runtime preflight passed") {
		t.Fatalf("warning finding should not fail preflight:\n%s", text)
	}
}
