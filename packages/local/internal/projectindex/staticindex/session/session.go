package session

import (
	"context"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/compat"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/run"
)

// Run creates a session from options and runs it once.
func Run(ctx context.Context, options Options) (Result, error) {
	return New(options).Run(ctx)
}

// Run plans the project and, when enabled, attempts Static Index execution.
func (s *Session) Run(ctx context.Context) (Result, error) {
	if s == nil {
		return Result{}, fmt.Errorf("Static Index session is not configured")
	}
	options := s.options
	if options.Planner == nil {
		return Result{}, fmt.Errorf("Static Index planner is not configured")
	}

	plan, err := options.Planner.Inspect(ctx, options.Root, options.ConfigPath, options.ProjectName)
	if err != nil {
		return Result{}, err
	}
	result := resultFromPlan(plan)
	result.NativeOnlyEligible = compat.NativeOnlyEligible(plan.Plan)
	if !plan.Plan.StaticSyntaxEnabled {
		result.Status = StatusDisabled
		return result, nil
	}

	if options.Compiler == nil {
		result.Status = StatusMissingCompiler
		return result, nil
	}
	if !compat.Schedulable(plan.Plan) {
		result.Status = StatusUnschedulable
		return result, nil
	}

	result.Status = StatusIncomplete
	runResult, err := run.Run(ctx, run.Request{
		Root:             options.Root,
		ConfigPath:       options.ConfigPath,
		ProjectName:      options.ProjectName,
		Plan:             plan.Plan,
		Compiler:         options.Compiler,
		Evidence:         options.Evidence,
		PatchOptions:     options.PatchOptions,
		PatchInvalidates: options.PatchInvalidates,
		CacheDisabled:    projectindex.CacheDisabled(ctx),
	})
	result.StaticTiming = runResult.Timing
	addNodeReason(&result, runResult.NodeReason)
	if err != nil {
		return result, err
	}
	if !runResult.Used {
		result.Status = StatusIncomplete
		return result, nil
	}
	result.Status = StatusComplete
	result.Patch = runResult.Patch
	result.UsedStaticIndex = true
	return result, nil
}
