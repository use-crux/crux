// Package reviewwriter invokes the project-local Core repository writer.
package reviewwriter

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/privacy"
	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
	"github.com/use-crux/crux/packages/local/internal/review"
)

type Writer struct {
	ProjectRoot string
	FindNode    func() (string, error)
	Extract     func() (string, error)
	Privacy     privacy.Provider
}

// AddReviewCase runs validation and atomic persistence in the project's Core copy.
func (w Writer) AddReviewCase(ctx context.Context, request review.AddCaseRequest) (review.AddCaseResult, error) {
	provider := w.Privacy
	if provider == nil {
		provider = privacy.Generated(w.ProjectRoot)
	}
	policy, err := provider.Current()
	if err != nil {
		return review.AddCaseResult{}, fmt.Errorf("load project privacy policy: %w", err)
	}
	request.RedactPaths = policy.RedactPaths
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
		return review.AddCaseResult{}, err
	}
	script, err := extract()
	if err != nil {
		return review.AddCaseResult{}, err
	}
	input, err := json.Marshal(request)
	if err != nil {
		return review.AddCaseResult{}, fmt.Errorf("encode Add-to-eval request: %w", err)
	}
	var result review.AddCaseResult
	found := false
	stream, err := workerproc.Stream(ctx, workerproc.OneShot{
		CommandPath: node,
		CommandArgs: []string{script},
		Args:        []string{"--review-add"},
		Dir:         w.ProjectRoot,
		Input:       input,
	}, func(raw json.RawMessage) error {
		var event struct {
			Type    string               `json:"type"`
			Message string               `json:"message"`
			Result  review.AddCaseResult `json:"result"`
		}
		if err := json.Unmarshal(raw, &event); err != nil {
			return err
		}
		if event.Type == "error" {
			return fmt.Errorf("Add-to-eval worker: %s", event.Message)
		}
		if event.Type == "review:add" {
			result, found = event.Result, true
		}
		return nil
	})
	if err != nil {
		return review.AddCaseResult{}, err
	}
	if stream.ExitErr != nil {
		return review.AddCaseResult{}, fmt.Errorf("Add-to-eval worker failed: %w: %s", stream.ExitErr, stream.Stderr)
	}
	if !found {
		return review.AddCaseResult{}, fmt.Errorf("Add-to-eval worker returned no result")
	}
	switch result.Status {
	case "added", "linked", "conflict", "pending-sync":
	default:
		return review.AddCaseResult{}, fmt.Errorf("Add-to-eval worker returned unsupported status %q", result.Status)
	}
	if result.Path == "" || result.Row == "" || result.Diff == "" || result.CaseID == "" {
		return review.AddCaseResult{}, fmt.Errorf("Add-to-eval worker returned an incomplete artifact")
	}
	return result, nil
}
