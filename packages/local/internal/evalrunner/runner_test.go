package evalrunner

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
)

func TestRunnerUsesCanonicalConfirmationAndReturnsPersistedRun(t *testing.T) {
	var args []string
	var input []byte
	runner := Coordinator{
		ProjectRoot: "/project",
		FindNode:    func() (string, error) { return "/node", nil },
		Extract:     func() (string, error) { return "/coordinator.mjs", nil },
		stream: func(_ context.Context, run workerproc.OneShot, emit func(json.RawMessage) error) (workerproc.StreamResult, error) {
			args = append([]string(nil), run.Args...)
			input = append([]byte(nil), run.Input...)
			if err := emit(json.RawMessage(`{"type":"eval:done","evalId":"support","run":{"runId":"evalrun_0123456789abcdef01234567","passed":true}}`)); err != nil {
				return workerproc.StreamResult{}, err
			}
			if err := emit(json.RawMessage(`{"type":"run:done","exitCode":0,"runIds":["evalrun_0123456789abcdef01234567"]}`)); err != nil {
				return workerproc.StreamResult{}, err
			}
			return workerproc.StreamResult{}, nil
		},
	}

	result, err := runner.Run(context.Background(), RunRequest{
		EvalID:             "support",
		ConfirmUnknownCost: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(args, []string{"support", "--request-unknown-cost-confirmation"}) {
		t.Fatalf("args = %#v", args)
	}
	if string(input) != "yes\n" {
		t.Fatalf("input = %q", input)
	}
	if result.RunID != "evalrun_0123456789abcdef01234567" || !result.Passed || result.ExitCode != 0 {
		t.Fatalf("result = %#v", result)
	}
}

func TestRunnerFailsClosedWithoutProjectRoot(t *testing.T) {
	runner := Coordinator{
		FindNode: func() (string, error) {
			t.Fatal("FindNode must not run without a project root")
			return "", nil
		},
	}
	_, err := runner.Run(context.Background(), RunRequest{EvalID: "support"})
	if err == nil || !strings.Contains(err.Error(), "project root") {
		t.Fatalf("Run() error = %v", err)
	}
}

func TestRunnerBoundsAndRedactsCoordinatorErrors(t *testing.T) {
	t.Setenv("CRUX_EVAL_HOST_TOKEN", "sensitive-eval-token")
	runner := Coordinator{
		ProjectRoot: "/project",
		FindNode:    func() (string, error) { return "/node", nil },
		Extract:     func() (string, error) { return "/coordinator.mjs", nil },
		stream: func(_ context.Context, _ workerproc.OneShot, emit func(json.RawMessage) error) (workerproc.StreamResult, error) {
			message, _ := json.Marshal("Bearer sensitive-eval-token " + strings.Repeat("x", 10_000))
			return workerproc.StreamResult{}, emit(json.RawMessage(`{"type":"error","message":` + string(message) + `}`))
		},
	}

	_, err := runner.Run(context.Background(), RunRequest{EvalID: "support"})
	if err == nil {
		t.Fatal("Run() error = nil")
	}
	if strings.Contains(err.Error(), "sensitive-eval-token") {
		t.Fatalf("Run() leaked token: %v", err)
	}
	if len(err.Error()) > 2_200 {
		t.Fatalf("Run() error length = %d", len(err.Error()))
	}
}

func TestRunnerRequiresTerminalEventAndPreservesFailingRun(t *testing.T) {
	runner := Coordinator{
		FindNode: func() (string, error) { return "/node", nil },
		Extract:  func() (string, error) { return "/coordinator.mjs", nil },
		stream: func(_ context.Context, _ workerproc.OneShot, emit func(json.RawMessage) error) (workerproc.StreamResult, error) {
			if err := emit(json.RawMessage(`{"type":"eval:done","evalId":"support","run":{"runId":"evalrun_failed","passed":false}}`)); err != nil {
				return workerproc.StreamResult{}, err
			}
			return workerproc.StreamResult{ExitErr: errors.New("exit status 1")}, nil
		},
	}

	_, err := runner.Run(context.Background(), RunRequest{EvalID: "support"})
	if err == nil {
		t.Fatal("Run() error = nil, want missing terminal event")
	}
}

func TestRunnerReturnsPersistedFailingRunWithoutUnknownCostConfirmation(t *testing.T) {
	runner := Coordinator{
		ProjectRoot: "/project",
		FindNode:    func() (string, error) { return "/node", nil },
		Extract:     func() (string, error) { return "/coordinator.mjs", nil },
		stream: func(_ context.Context, run workerproc.OneShot, emit func(json.RawMessage) error) (workerproc.StreamResult, error) {
			if !slices.Equal(run.Args, []string{"support", "--decline-unknown-cost-confirmation"}) || run.Input != nil {
				t.Fatalf("run = %#v", run)
			}
			if err := emit(json.RawMessage(`{"type":"eval:done","evalId":"support","run":{"runId":"evalrun_failed","passed":false}}`)); err != nil {
				return workerproc.StreamResult{}, err
			}
			if err := emit(json.RawMessage(`{"type":"run:done","exitCode":1,"runIds":["evalrun_failed"]}`)); err != nil {
				return workerproc.StreamResult{}, err
			}
			return workerproc.StreamResult{ExitErr: errors.New("exit status 1")}, nil
		},
	}

	result, err := runner.Run(context.Background(), RunRequest{EvalID: "support"})
	if err != nil {
		t.Fatal(err)
	}
	if result.RunID != "evalrun_failed" || result.Passed || result.ExitCode != 1 {
		t.Fatalf("result = %#v", result)
	}
}
