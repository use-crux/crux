package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
)

type EvalBridgeRunner struct {
	CWD        string
	ConfigPath string
}

type evalRunnerEvent struct {
	Type           string          `json:"type"`
	Summary        json.RawMessage `json:"summary,omitempty"`
	Export         json.RawMessage `json:"export,omitempty"`
	AnalysisPrompt string          `json:"analysisPrompt,omitempty"`
	Count          int             `json:"count,omitempty"`
	ExperimentIDs  []string        `json:"experimentIds,omitempty"`
	Message        string          `json:"message,omitempty"`
	Name           string          `json:"name,omitempty"`
	Stack          string          `json:"stack,omitempty"`
	Details        json.RawMessage `json:"details,omitempty"`
}

func (r EvalBridgeRunner) RunEval(ctx context.Context, req runtimebridge.EvalRunRequest) (runtimebridge.EvalRunResult, error) {
	nodePath, err := FindNode()
	if err != nil {
		return runtimebridge.EvalRunResult{}, err
	}
	runnerPath, err := ExtractEvalRunner()
	if err != nil {
		return runtimebridge.EvalRunResult{}, fmt.Errorf("failed to extract embedded eval runner: %w", err)
	}

	args := []string{"--import", "tsx/esm", runnerPath}
	if r.ConfigPath != "" {
		args = append(args, "--config", r.ConfigPath)
	}
	if filter := evalRunFilter(req); filter != "" {
		args = append(args, "--filter", filter)
	}
	for _, caseID := range req.CaseIDs {
		if strings.TrimSpace(caseID) != "" {
			args = append(args, "--case", caseID)
		}
	}
	if !req.Persist {
		args = append(args, "--no-persist")
	}

	cmd := exec.CommandContext(ctx, nodePath, args...)
	if r.CWD != "" {
		cmd.Dir = r.CWD
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return runtimebridge.EvalRunResult{}, fmt.Errorf("failed to create eval runner stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return runtimebridge.EvalRunResult{}, fmt.Errorf("failed to start eval runner: %w", err)
	}

	result := runtimebridge.EvalRunResult{}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)
	for scanner.Scan() {
		var event evalRunnerEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			continue
		}
		switch event.Type {
		case "summary":
			result.Summary = cloneRaw(event.Summary)
			result.Export = cloneRaw(event.Export)
			result.AnalysisPrompt = event.AnalysisPrompt
		case "quality:persisted":
			result.ExperimentIDs = append(result.ExperimentIDs, event.ExperimentIDs...)
		case "error":
			return runtimebridge.EvalRunResult{}, evalRunnerCommandError(event)
		}
	}
	if err := scanner.Err(); err != nil {
		return runtimebridge.EvalRunResult{}, fmt.Errorf("read eval runner output: %w", err)
	}
	if err := cmd.Wait(); err != nil {
		if len(result.Summary) > 0 {
			return result, nil
		}
		detail := strings.TrimSpace(stderr.String())
		if detail != "" {
			return runtimebridge.EvalRunResult{}, evalRunnerProcessError(err, detail)
		}
		return runtimebridge.EvalRunResult{}, evalRunnerProcessError(err, "")
	}
	return result, nil
}

func evalRunnerCommandError(event evalRunnerEvent) error {
	message := strings.TrimSpace(event.Message)
	if message == "" {
		message = "Eval runner failed"
	}
	return runtimebridge.NewCommandExecutionError("eval_runner_error", message, evalRunnerErrorDetails(event), nil)
}

func evalRunnerErrorDetails(event evalRunnerEvent) json.RawMessage {
	var details map[string]any
	if len(event.Details) > 0 {
		_ = json.Unmarshal(event.Details, &details)
	}
	if details == nil {
		details = map[string]any{}
	}
	details["thrown"] = "error"
	if _, ok := details["phase"]; !ok {
		details["phase"] = "eval_runner.main"
	}
	if _, ok := details["errorKind"]; !ok {
		details["errorKind"] = "eval_runner_error"
	}
	if event.Stack != "" {
		details["stack"] = event.Stack
	}
	summary, _ := details["summary"].(map[string]any)
	if summary == nil {
		summary = map[string]any{}
		details["summary"] = summary
	}
	if _, ok := summary["message"]; !ok {
		summary["message"] = firstNonEmpty(event.Message, "Eval runner failed")
	}
	if _, ok := summary["name"]; !ok && event.Name != "" {
		summary["name"] = event.Name
	}
	if _, ok := summary["category"]; !ok {
		summary["category"] = "eval_runner_error"
	}
	raw, _ := json.Marshal(details)
	return raw
}

func evalRunnerProcessError(err error, stderr string) error {
	message := "eval runner failed"
	if stderr != "" {
		message += ": " + stderr
	}
	details, _ := json.Marshal(map[string]any{
		"thrown":    "error",
		"phase":     "eval_runner.process",
		"errorKind": "eval_runner_exit",
		"stderr":    stderr,
		"summary": map[string]any{
			"message":  message,
			"name":     "ExitError",
			"category": "eval_runner_exit",
		},
	})
	return runtimebridge.NewCommandExecutionError("eval_runner_exit", message, details, err)
}

func evalRunFilter(req runtimebridge.EvalRunRequest) string {
	for _, candidate := range []string{req.SuiteID, req.TargetID} {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		for _, prefix := range []string{"eval:", "suite:", "flow-eval:", "rag-eval:", "experiment:"} {
			candidate = strings.TrimPrefix(candidate, prefix)
		}
		return candidate
	}
	return ""
}

func cloneRaw(value json.RawMessage) json.RawMessage {
	if len(value) == 0 {
		return nil
	}
	out := make([]byte, len(value))
	copy(out, value)
	return out
}
