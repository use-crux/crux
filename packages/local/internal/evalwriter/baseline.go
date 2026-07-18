package evalwriter

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
)

// Writer delegates Eval mutations to the embedded coordinator and the
// project's installed Core package.
type Writer struct {
	ProjectRoot string
	FindNode    func() (string, error)
	Extract     func() (string, error)
}

// SetBaseline asks Core to validate the run and atomically write its sibling
// Baseline. This layer deliberately does not duplicate eligibility rules.
func (w Writer) SetBaseline(ctx context.Context, request SetBaselineRequest) (SetBaselineResult, error) {
	node, script, err := w.dependencies()
	if err != nil {
		return SetBaselineResult{}, err
	}
	args := []string{"--baseline-set", request.RunID}
	if request.Variant != "" {
		args = append(args, "--variant", request.Variant)
	}
	if request.AcceptFailing {
		args = append(args, "--accept-failing")
	}
	var result SetBaselineResult
	found := false
	stream, err := workerproc.Stream(ctx, workerproc.OneShot{
		CommandPath: node,
		CommandArgs: []string{script},
		Args:        args,
		Dir:         w.ProjectRoot,
	}, func(raw json.RawMessage) error {
		var event struct {
			Type    string `json:"type"`
			Message string `json:"message"`
			RunID   string `json:"runId"`
			Path    string `json:"path"`
		}
		if err := json.Unmarshal(raw, &event); err != nil {
			return err
		}
		if event.Type == "error" {
			return fmt.Errorf("set Eval Baseline: %s", event.Message)
		}
		if event.Type == "baseline:done" {
			result = SetBaselineResult{RunID: event.RunID, Path: event.Path}
			found = true
		}
		return nil
	})
	if err != nil {
		return SetBaselineResult{}, err
	}
	if stream.ExitErr != nil {
		return SetBaselineResult{}, fmt.Errorf("set Eval Baseline worker failed: %w: %s", stream.ExitErr, stream.Stderr)
	}
	if !found || result.RunID == "" || result.Path == "" {
		return SetBaselineResult{}, fmt.Errorf("set Eval Baseline worker returned no complete artifact")
	}
	return result, nil
}

func (w Writer) dependencies() (string, string, error) {
	findNode := w.FindNode
	if findNode == nil {
		findNode = assets.FindNode
	}
	extract := w.Extract
	if extract == nil {
		extract = assets.ExtractEmbeddedEvalCoordinator
	}
	node, err := findNode()
	if err != nil {
		return "", "", err
	}
	script, err := extract()
	return node, script, err
}
