package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
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
			name:      "setup check",
			args:      []string{"--json", "--cwd", root, "setup", "--check"},
			operation: "setup-check",
		},
		{
			name:      "setup apply",
			args:      []string{"--json", "--cwd", root, "setup", "--apply"},
			operation: "setup-apply",
		},
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
			called := false
			runRuntimeOperationForCommand = func(_ context.Context, gotRoot, gotOperation, gotWorkID string) (json.RawMessage, error) {
				called = true
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

			cmd := NewRuntimeCmd(&cli.Factory{})
			var out, errOut strings.Builder
			cmd.SetOut(&out)
			cmd.SetErr(&errOut)
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

func TestRuntimeSetupRequiresExactlyOneMode(t *testing.T) {
	cmd := NewRuntimeCmd(&cli.Factory{})
	cmd.SetArgs([]string{"setup"})

	err := cmd.Execute()
	if err == nil {
		t.Fatal("crux runtime setup without a mode succeeded")
	}
	if !strings.Contains(err.Error(), "choose exactly one of --check or --apply") {
		t.Fatalf("error = %q", err.Error())
	}
}

func TestRuntimeGeneratePreflightReportsMissingNonTerminalTargets(t *testing.T) {
	oldRunner := runRuntimeOperationForCommand
	defer func() { runRuntimeOperationForCommand = oldRunner }()

	runRuntimeOperationForCommand = func(_ context.Context, _, operation, _ string) (json.RawMessage, error) {
		switch operation {
		case "setup-check":
			return json.RawMessage(`{"operation":"setup-check","ok":true,"setup":{"ok":true,"findings":[]}}`), nil
		case "status":
			return json.RawMessage(`{
			  "operation": "status",
			  "ok": true,
			  "namespace": "local",
			  "counts": [
			    { "status": "pending", "targetId": "old-review", "count": 2 },
			    { "status": "blocked", "targetId": "blocked-old-review", "count": 1 },
			    { "status": "suspended", "targetId": "review", "count": 1 }
			  ]
			}`), nil
		default:
			t.Fatalf("unexpected operation %q", operation)
			return nil, nil
		}
	}

	var out, errOut bytes.Buffer
	io := output.NewTestIO(&out, &errOut, output.TestIOOptions{ColorEnabled: false})
	printRuntimeGeneratePreflight(io, t.TempDir(), json.RawMessage(`{
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
