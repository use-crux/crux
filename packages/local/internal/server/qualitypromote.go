package server

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
	"github.com/use-crux/crux/packages/local/internal/quality"
)

// Server-side promotion: runs the embedded quality worker in --promote mode
// (the same validated path as `crux quality promote` — filtered-run refusal,
// explicit-id requirement, variant selection) and returns the promoted
// baseline. This is the devtools UI/TUI write path for baselines; the
// BaselineRecord itself is committed to the repo by the worker.

// QualityPromoteRequest is the POST /api/quality/promote body.
type QualityPromoteRequest struct {
	ExperimentID string `json:"experimentId"`
	Variant      string `json:"variant,omitempty"`
	PinID        string `json:"pinId,omitempty"`
}

const qualityPromoteTimeout = 120 * time.Second

// RunQualityPromote spawns the embedded worker's promote mode against the
// project and parses its NDJSON outcome.
func RunQualityPromote(ctx context.Context, projectRoot, configPath string, req QualityPromoteRequest) (api.QualityPromoteResult, error) {
	if req.ExperimentID == "" {
		return api.QualityPromoteResult{}, fmt.Errorf("experimentId is required")
	}
	nodePath, err := FindNode()
	if err != nil {
		return api.QualityPromoteResult{}, err
	}
	runnerPath, err := ExtractQualityRunner()
	if err != nil {
		return api.QualityPromoteResult{}, fmt.Errorf("failed to extract embedded quality runner: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, qualityPromoteTimeout)
	defer cancel()

	args := []string{"--import", "tsx/esm", runnerPath, "--promote", req.ExperimentID}
	if req.Variant != "" {
		args = append(args, "--variant", req.Variant)
	}
	if req.PinID != "" {
		args = append(args, "--pin-id", req.PinID)
	}
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
	result, found, promoteErr := parsePromoteOutcome(stdout.Bytes())
	if promoteErr != nil {
		return api.QualityPromoteResult{}, promoteErr
	}
	if !found {
		if runErr != nil {
			return api.QualityPromoteResult{}, fmt.Errorf("promote failed: %w: %s", runErr, tail(stderr.String(), 400))
		}
		return api.QualityPromoteResult{}, fmt.Errorf("promote produced no outcome")
	}
	return result, nil
}

// parsePromoteOutcome scans the worker stream for promote:done or an error
// event (spec 03 §2).
func parsePromoteOutcome(stdout []byte) (api.QualityPromoteResult, bool, error) {
	scanner := bufio.NewScanner(bytes.NewReader(stdout))
	scanner.Buffer(make([]byte, 0, 1024*1024), 64*1024*1024)
	for scanner.Scan() {
		var event struct {
			Type         string `json:"type"`
			Scope        string `json:"scope"`
			Message      string `json:"message"`
			EvaluationID string `json:"evaluationId"`
			ExperimentID string `json:"experimentId"`
			BaselineID   string `json:"baselineId"`
			VariantName  string `json:"variantName"`
			Path         string `json:"path"`
			PinHint      string `json:"pinHint"`
		}
		if json.Unmarshal(scanner.Bytes(), &event) != nil {
			continue
		}
		switch event.Type {
		case "promote:done":
			return api.QualityPromoteResult{
				BaselineID:   event.BaselineID,
				EvaluationID: event.EvaluationID,
				ExperimentID: event.ExperimentID,
				VariantName:  event.VariantName,
				Path:         event.Path,
				PinHint:      event.PinHint,
			}, true, nil
		case "error":
			return api.QualityPromoteResult{}, false, fmt.Errorf("%s", event.Message)
		}
	}
	return api.QualityPromoteResult{}, false, nil
}

func registerQualityPromoteHTTP(mux *http.ServeMux, projectRoot, configPath string, qualityEvents *quality.EventBus) {
	mux.HandleFunc("POST /api/quality/promote", func(w http.ResponseWriter, r *http.Request) {
		var req QualityPromoteRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		result, err := RunQualityPromote(r.Context(), projectRoot, configPath, req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
			return
		}
		if qualityEvents != nil {
			qualityEvents.PublishActivity(api.QualityActivityEvent{
				Tag:       "QualityActivityEvent",
				Timestamp: time.Now().UnixMilli(),
				Kind:      "baseline",
				Severity:  "info",
				Summary:   fmt.Sprintf("baseline promoted: %s", result.EvaluationID),
				RefID:     result.BaselineID,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(result)
	})
}
