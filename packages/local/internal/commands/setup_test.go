package commands

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
)

func TestSetupCommandRoutesModesToWorker(t *testing.T) {
	old := runRuntimeOperationForCommand
	defer func() { runRuntimeOperationForCommand = old }()
	for _, tc := range []struct {
		name      string
		args      []string
		operation string
	}{
		{"default check", nil, "project-setup-check"},
		{"explicit check", []string{"--check"}, "project-setup-check"},
		{"apply", []string{"--apply"}, "project-setup-apply"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			runRuntimeOperationForCommand = func(_ context.Context, _, operation, _ string) (json.RawMessage, error) {
				if operation != tc.operation {
					t.Fatalf("operation = %q", operation)
				}
				return json.RawMessage(`{"operation":"` + operation + `","ok":true,"mode":"check","findings":[],"actions":[],"applied":[]}`), nil
			}
			cmd := NewSetupCmd(&cli.Factory{})
			cmd.SetArgs(append([]string{"--json"}, tc.args...))
			if err := cmd.Execute(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSetupRejectsCheckAndApply(t *testing.T) {
	cmd := NewSetupCmd(&cli.Factory{})
	cmd.SetArgs([]string{"--check", "--apply"})
	if err := cmd.Execute(); err == nil || !strings.Contains(err.Error(), "at most one") {
		t.Fatalf("error = %v", err)
	}
}
