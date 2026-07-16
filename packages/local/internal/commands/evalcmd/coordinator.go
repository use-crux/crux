package evalcmd

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/projectroot"
)

type coordinatorEvent struct {
	Type     string        `json:"type"`
	EvalID   string        `json:"evalId"`
	ExitCode int           `json:"exitCode"`
	Message  string        `json:"message"`
	Path     string        `json:"path"`
	RunIDs   []string      `json:"runIds"`
	Plan     evalPlanEvent `json:"plan"`
	Run      evalRunEvent  `json:"run"`
	Evals    []struct {
		ID        string `json:"id"`
		SourceKey struct {
			RelativeFile string `json:"relativeFile"`
		} `json:"sourceKey"`
		Cases []json.RawMessage `json:"cases"`
	} `json:"evals"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

type evalPlanEvent struct {
	Preflight struct {
		Status string `json:"status"`
	} `json:"preflight"`
	Cost struct {
		Admission struct {
			Status string `json:"status"`
		} `json:"admission"`
		KnownMaximumUSD    float64 `json:"knownMaximumUsd"`
		UnknownActionCount int     `json:"unknownActionCount"`
	} `json:"cost"`
	Cells []struct {
		CaseID  string `json:"caseId"`
		Variant string `json:"variant"`
		Trial   int    `json:"trial"`
		Action  struct {
			Kind   string `json:"kind"`
			Reason string `json:"reason"`
		} `json:"action"`
	} `json:"cells"`
}

type evalRunEvent struct {
	RunID  string `json:"runId"`
	Status string `json:"status"`
	Passed bool   `json:"passed"`
	Cells  []struct {
		CaseID  string `json:"caseId"`
		Variant string `json:"variant"`
		Status  string `json:"status"`
		Task    struct {
			Status string `json:"status"`
		} `json:"task"`
	} `json:"cells"`
}

func runCoordinator(command *cobra.Command, cwd string, args []string) error {
	node, err := assets.FindNode()
	if err != nil {
		return err
	}
	worker, err := assets.ExtractEmbeddedEvalCoordinator()
	if err != nil {
		return fmt.Errorf("extract Eval coordinator: %w", err)
	}
	child := exec.Command(node, append([]string{"--import", "tsx/esm", worker}, args...)...)
	child.Env = os.Environ()
	if cwd == "" {
		cwd = projectroot.Dir()
	}
	child.Dir = cwd
	stdout, err := child.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := child.StderrPipe()
	if err != nil {
		return err
	}
	if err := child.Start(); err != nil {
		return err
	}
	go func() { _, _ = io.Copy(command.Root().ErrOrStderr(), stderr) }()
	exitCode, streamErr := consumeStream(command.Root().OutOrStdout(), stdout)
	waitErr := child.Wait()
	if streamErr != nil {
		return streamErr
	}
	if exitCode != 0 {
		return domain.ExitError{Code: exitCode}
	}
	return waitErr
}

func consumeStream(out io.Writer, stream io.Reader) (int, error) {
	exitCode := 2
	preExecutionFailed := false
	scanner := bufio.NewScanner(stream)
	for scanner.Scan() {
		var event coordinatorEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			return 2, fmt.Errorf("invalid Eval coordinator event: %w", err)
		}
		switch event.Type {
		case "collect:done":
			for _, discovered := range event.Evals {
				_, _ = fmt.Fprintf(out, "%s\t%d Cases\t%s\n", discovered.ID, len(discovered.Cases), discovered.SourceKey.RelativeFile)
			}
			for _, problem := range event.Errors {
				_, _ = fmt.Fprintln(out, problem.Message)
			}
			preExecutionFailed = len(event.Errors) > 0
		case "eval:plan":
			renderEvalPlan(out, event.EvalID, event.Plan)
		case "eval:start":
			_, _ = fmt.Fprintf(out, "running %s\n", event.EvalID)
		case "eval:done":
			renderEvalDone(out, event.EvalID, event.Run)
		case "error":
			preExecutionFailed = true
			if event.Message != "" {
				_, _ = fmt.Fprintln(out, event.Message)
			}
		case "warning":
			if event.Message != "" {
				_, _ = fmt.Fprintf(out, "warning: %s\n", event.Message)
			}
		case "baseline:done":
			_, _ = fmt.Fprintf(out, "Baseline written to %s\n", event.Path)
		case "run:done":
			exitCode = event.ExitCode
			if len(event.RunIDs) > 0 {
				_, _ = fmt.Fprintf(out, "%d Eval run(s) saved\n", len(event.RunIDs))
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return 2, err
	}
	if preExecutionFailed {
		return 2, nil
	}
	if exitCode == 2 {
		return 2, fmt.Errorf("Eval coordinator stopped before a terminal run event")
	}
	return exitCode, nil
}

func renderEvalPlan(out io.Writer, evalID string, plan evalPlanEvent) {
	_, _ = fmt.Fprintf(out, "plan %s: %s; cost %s (known max $%.6f, %d unknown)\n", evalID, plan.Preflight.Status, plan.Cost.Admission.Status, plan.Cost.KnownMaximumUSD, plan.Cost.UnknownActionCount)
	for _, cell := range plan.Cells {
		_, _ = fmt.Fprintf(out, "  %s/%s/trial-%d: %s (%s)\n", cell.CaseID, cell.Variant, cell.Trial+1, cell.Action.Kind, cell.Action.Reason)
	}
}

func renderEvalDone(out io.Writer, evalID string, run evalRunEvent) {
	for _, cell := range run.Cells {
		_, _ = fmt.Fprintf(out, "  %s/%s: %s; task %s\n", cell.CaseID, cell.Variant, cell.Status, cell.Task.Status)
	}
	_, _ = fmt.Fprintf(out, "%s: %s passed=%t run=%s\n", evalID, run.Status, run.Passed, run.RunID)
}
