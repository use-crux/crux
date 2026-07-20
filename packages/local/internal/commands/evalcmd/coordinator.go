package evalcmd

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"

	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/projectroot"
)

const evalCoordinatorMaxEventBytes = 64 * 1024 * 1024

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
	HostReadiness struct {
		Status       string   `json:"status"`
		DeploymentID string   `json:"deploymentId"`
		HostKind     string   `json:"hostKind"`
		Reason       string   `json:"reason"`
		Remedies     []string `json:"remedies"`
		Remedy       string   `json:"remedy"`
	} `json:"hostReadiness"`
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
	ScorerActions []struct {
		ActionID           string `json:"actionId"`
		ScorerName         string `json:"scorerName"`
		Kind               string `json:"kind"`
		Reason             string `json:"reason"`
		ExternalKind       string `json:"externalKind"`
		Admission          string `json:"admission"`
		EvidenceRead       string `json:"evidenceRead"`
		EvidenceReadReason string `json:"evidenceReadReason"`
		Price              struct {
			Kind string `json:"kind"`
		} `json:"price"`
		Reservation struct {
			Kind          string `json:"kind"`
			ReservationID string `json:"reservationId"`
		} `json:"reservation"`
		Evidence struct {
			Fingerprint string `json:"fingerprint"`
		} `json:"evidence"`
	} `json:"scorerActions"`
}

type evalRunEvent struct {
	RunID  string `json:"runId"`
	Status string `json:"status"`
	Passed bool   `json:"passed"`
	Cost   struct {
		ActualUSD *float64 `json:"actualUsd"`
	} `json:"cost"`
	Cells []struct {
		CaseID  string `json:"caseId"`
		Variant string `json:"variant"`
		Trial   int    `json:"trial"`
		Status  string `json:"status"`
		Task    struct {
			Status string `json:"status"`
			Reason string `json:"reason"`
		} `json:"task"`
		Scores     []scoreProjection `json:"scores"`
		Assertions struct {
			Ran          int                          `json:"ran"`
			NotEvaluated int                          `json:"notEvaluated"`
			Outcomes     []assertionOutcomeProjection `json:"outcomes"`
		} `json:"assertions"`
		Metrics struct {
			DurationMS int      `json:"durationMs"`
			CostUSD    *float64 `json:"costUsd"`
		} `json:"metrics"`
		RunIDs []string `json:"runIds"`
		Error  *struct {
			Message string `json:"message"`
			Phase   string `json:"phase"`
		} `json:"error"`
	} `json:"cells"`
}

func runCoordinator(streams *output.IO, cwd string, args []string) error {
	node, err := assets.FindNode()
	if err != nil {
		return err
	}
	worker, err := assets.ExtractEmbeddedEvalCoordinator()
	if err != nil {
		return fmt.Errorf("extract Eval coordinator: %w", err)
	}
	child := exec.Command(node, append([]string{worker}, args...)...)
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
	stdin, err := child.StdinPipe()
	if err != nil {
		return err
	}
	if err := child.Start(); err != nil {
		return err
	}
	go func() { _, _ = io.Copy(streams.Err, stderr) }()
	exitCode, streamErr := consumeStreamWithConfirmation(streams.Out, stdout, func() error {
		confirmed, confirmErr := confirmUnknownCost(streams)
		if confirmErr != nil {
			return confirmErr
		}
		answer := "no"
		if confirmed {
			answer = "yes"
		}
		_, writeErr := fmt.Fprintln(stdin, answer)
		return writeErr
	})
	_ = stdin.Close()
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
	return consumeStreamWithConfirmation(out, stream, nil)
}

func consumeStreamWithConfirmation(out io.Writer, stream io.Reader, confirm func() error) (int, error) {
	exitCode := 2
	preExecutionFailed := false
	unattestedGuidance := make(map[string]bool)
	sourceGuidance := make(map[string]bool)
	taskBindingGuidance := make(map[string]bool)
	scanner := bufio.NewScanner(stream)
	scanner.Buffer(make([]byte, 0, 1024*1024), evalCoordinatorMaxEventBytes)
	for scanner.Scan() {
		var event coordinatorEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			return 2, fmt.Errorf("invalid Eval coordinator event: %w", err)
		}
		switch event.Type {
		case "cost:confirmation-required":
			if confirm == nil {
				return 2, fmt.Errorf("Eval coordinator requested unavailable cost confirmation")
			}
			if err := confirm(); err != nil {
				return 2, err
			}
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
			if planHasUnattestedModel(event.Plan) {
				unattestedGuidance[event.EvalID] = true
			}
			if planHasUnresolvedSource(event.Plan) {
				sourceGuidance[event.EvalID] = true
			}
			if planHasUntrackedTaskBinding(event.Plan) {
				taskBindingGuidance[event.EvalID] = true
			}
		case "eval:start":
			_, _ = fmt.Fprintf(out, "running %s\n", event.EvalID)
		case "eval:done":
			showUnattested := runHasUnattestedModel(event.Run) && !unattestedGuidance[event.EvalID]
			showSource := runHasUnresolvedSource(event.Run) && !sourceGuidance[event.EvalID]
			showTaskBinding := runHasUntrackedTaskBinding(event.Run) && !taskBindingGuidance[event.EvalID]
			renderEvalDone(out, event.EvalID, event.Run, showUnattested, showSource, showTaskBinding)
			if showUnattested {
				unattestedGuidance[event.EvalID] = true
			}
			if showSource {
				sourceGuidance[event.EvalID] = true
			}
			if showTaskBinding {
				taskBindingGuidance[event.EvalID] = true
			}
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
		return 2, fmt.Errorf("read Eval coordinator event (maximum %d bytes): %w", evalCoordinatorMaxEventBytes, err)
	}
	if preExecutionFailed {
		return 2, nil
	}
	if exitCode == 2 {
		return 2, fmt.Errorf("Eval coordinator stopped before a terminal run event")
	}
	return exitCode, nil
}
