package quality

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	qualitysvc "github.com/use-crux/crux/packages/local/internal/quality"
)

// Server-side experiment diff: runs the embedded quality worker in --diff mode
// (the same core-owned compare op as `crux quality diff`, policy in core per
// I5) and returns the §6.3 ExperimentDiff JSON verbatim. This is the devtools
// UI "Compare…" path; no record is written.

const qualityDiffTimeout = 120 * time.Second

// RunDiff spawns the embedded worker's diff mode against two resolved record
// paths and returns the diff JSON verbatim.
func RunDiff(ctx context.Context, projectRoot, configPath string, deps RunnerDeps, aPath, bPath string) (json.RawMessage, error) {
	nodePath, err := deps.FindNode()
	if err != nil {
		return nil, err
	}
	runnerPath, err := deps.ExtractRunner()
	if err != nil {
		return nil, fmt.Errorf("failed to extract embedded quality runner: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, qualityDiffTimeout)
	defer cancel()

	args := []string{"--import", "tsx/esm", runnerPath, "--diff-a", aPath, "--diff-b", bPath}
	if configPath != "" {
		args = append(args, "--config", configPath)
	}
	cmd := exec.CommandContext(ctx, nodePath, args...)
	if projectRoot != "" {
		cmd.Dir = projectRoot
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()
	diff, found, diffErr := parseDiffOutcome(stdout.Bytes())
	if diffErr != nil {
		return nil, diffErr
	}
	if !found {
		if runErr != nil {
			return nil, fmt.Errorf("diff failed: %w: %s", runErr, tail(stderr.String(), 400))
		}
		return nil, fmt.Errorf("diff produced no outcome")
	}
	return diff, nil
}

// parseDiffOutcome scans the worker stream for the diff:done event (spec 03 §2)
// and returns its diff payload verbatim.
func parseDiffOutcome(stdout []byte) (json.RawMessage, bool, error) {
	scanner := bufio.NewScanner(bytes.NewReader(stdout))
	scanner.Buffer(make([]byte, 0, 1024*1024), 64*1024*1024)
	for scanner.Scan() {
		var event struct {
			Type    string          `json:"type"`
			Diff    json.RawMessage `json:"diff"`
			Message string          `json:"message"`
		}
		if json.Unmarshal(scanner.Bytes(), &event) != nil {
			continue
		}
		switch event.Type {
		case "diff:done":
			return event.Diff, true, nil
		case "error":
			return nil, false, fmt.Errorf("%s", event.Message)
		}
	}
	return nil, false, nil
}

// RegisterDiff wires GET /api/quality/experiments/diff?a=&b= against the
// worker. Experiment ids are resolved to record paths and the diff op runs in
// core; a diff activity entry is published on success (blueprint §11.2/§12.3).
func RegisterDiff(mux *http.ServeMux, projectRoot, configPath string, deps RunnerDeps, resolvePath func(id string) string, qualityEvents *qualitysvc.EventBus) {
	runDiff := func(ctx context.Context, aPath, bPath string) (json.RawMessage, error) {
		return RunDiff(ctx, projectRoot, configPath, deps, aPath, bPath)
	}
	registerDiffHandler(mux, resolvePath, runDiff, qualityEvents)
}

func registerDiffHandler(
	mux *http.ServeMux,
	resolvePath func(id string) string,
	runDiff func(ctx context.Context, aPath, bPath string) (json.RawMessage, error),
	qualityEvents *qualitysvc.EventBus,
) {
	mux.HandleFunc("GET /api/quality/experiments/diff", func(w http.ResponseWriter, r *http.Request) {
		a := r.URL.Query().Get("a")
		b := r.URL.Query().Get("b")
		if a == "" || b == "" {
			http.Error(w, "both a and b experiment ids are required", http.StatusBadRequest)
			return
		}
		diff, err := runDiff(r.Context(), resolvePath(a), resolvePath(b))
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
			return
		}
		publishDiffActivity(qualityEvents, diff)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(diff)
	})
}

// publishDiffActivity records one diff milestone in the quality activity feed,
// matching the run-event forwarder's diff:done shape (server/quality events.go).
func publishDiffActivity(qualityEvents *qualitysvc.EventBus, diff json.RawMessage) {
	if qualityEvents == nil {
		return
	}
	var parsed struct {
		A struct {
			ExperimentID string `json:"experimentId"`
		} `json:"a"`
		B struct {
			ExperimentID string `json:"experimentId"`
		} `json:"b"`
	}
	if json.Unmarshal(diff, &parsed) != nil || parsed.A.ExperimentID == "" || parsed.B.ExperimentID == "" {
		return
	}
	qualityEvents.PublishActivity(api.QualityActivityEvent{
		Tag:       "QualityActivityEvent",
		Timestamp: time.Now().UnixMilli(),
		Kind:      "diff",
		Severity:  "info",
		Summary:   fmt.Sprintf("experiment diff completed: %s to %s", parsed.A.ExperimentID, parsed.B.ExperimentID),
		RefID:     parsed.A.ExperimentID + ".." + parsed.B.ExperimentID,
	})
}
