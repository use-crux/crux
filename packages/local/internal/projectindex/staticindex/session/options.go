package session

import (
	"context"
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/planner"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/run"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/run/patch"
)

// Planner inspects project config and source files to produce a Static Index
// execution plan.
type Planner interface {
	Inspect(context.Context, string, string, string) (planner.InspectResult, error)
}

// PlannerFunc adapts a function to the Planner interface.
type PlannerFunc func(context.Context, string, string, string) (planner.InspectResult, error)

// Inspect calls f(ctx, root, configPath, projectName).
func (f PlannerFunc) Inspect(ctx context.Context, root, configPath, projectName string) (planner.InspectResult, error) {
	return f(ctx, root, configPath, projectName)
}

// Compiler is the Static Index compiler lane used by a session.
type Compiler = run.Compiler

// EvidenceFunc fetches TypeScript-host evidence requested by the native
// compiler when a plan is schedulable but not fully native-only.
type EvidenceFunc = run.EvidenceFunc

// PatchOptions configures the Project Index patch emitted by Static Index
// finalize or compile streams.
type PatchOptions = patch.Options

// Options configures one Static Index session.
type Options struct {
	// Root is the project root being indexed.
	Root string
	// ConfigPath is the optional Crux config path for the project.
	ConfigPath string
	// ProjectName is the user-visible Project Index project name.
	ProjectName string
	// Planner creates the Static Index execution plan.
	Planner Planner
	// Compiler runs the Static Index compiler lane when the plan enables it.
	Compiler Compiler
	// Evidence fetches host-owned compatibility evidence for extension jobs.
	Evidence EvidenceFunc
	// PatchOptions configures finalize/compile patch construction.
	PatchOptions PatchOptions
	// PatchInvalidates overrides the default patch invalidation emitted by the
	// Static Index compiler, used by incremental file-scoped refreshes.
	PatchInvalidates json.RawMessage
}

// Session runs Static Index orchestration with fixed options.
type Session struct {
	options Options
}

// New creates a Static Index session from options.
func New(options Options) *Session {
	return &Session{options: options}
}
