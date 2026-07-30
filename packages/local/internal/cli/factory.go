// Package cli provides application-level wiring for the crux CLI.
// It holds the [Factory] which is the single dependency container
// passed to all Cobra command constructors.
package cli

import (
	"sync"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// Factory holds shared dependencies for all CLI commands. It is created once
// in main and passed to every NewXxxCmd constructor. Resources like the API
// client are lazily initialized on first access so commands that don't need
// them (e.g. "crux dev") pay no cost.
//
// Inspired by the GitHub CLI's factory pattern.
type Factory struct {
	// Port is the devtools server port (default 4400, set via --port flag).
	Port int
	// NoColor disables colored output when true (set via --no-color flag).
	NoColor bool
	// JSON requests machine-readable output from commands that support it.
	JSON bool

	clientOnce sync.Once
	client     *api.Client

	ioOnce sync.Once
	io     *output.IO
}

// JSONOutput combines the root persistent flag with a command-local
// compatibility flag.
func (f *Factory) JSONOutput(local bool) bool {
	return f.JSON || local
}

// NewFactoryWithStreams builds a Factory whose command output is routed
// through streams. It is the deterministic construction boundary for command
// embeddings and tests; production may continue to use a zero-value Factory,
// which lazily binds the process streams in [Factory.Streams].
func NewFactoryWithStreams(streams *output.IO) *Factory {
	f := &Factory{}
	f.ioOnce.Do(func() {
		f.io = streams
	})
	return f
}

// Client returns the API client for the devtools server, creating it on first
// call. The client targets http://localhost:{Port}. Safe for concurrent use.
func (f *Factory) Client() *api.Client {
	f.clientOnce.Do(func() {
		f.client = api.NewDefault(f.Port)
	})
	return f.client
}

// ClientFor returns the shared API client scoped with a user-facing command
// name for connection remediation.
func (f *Factory) ClientFor(command string) *api.Client {
	return f.Client().WithCommand(command)
}

// Streams returns the shared [output.IO] for terminal-capability decisions
// (color, TTY, width, CI), constructing it from the real process streams on
// first call. It observes the root --no-color flag via f.NoColor.
//
// Like Client, it is built lazily: a zero-value Factory{} (as constructed in
// tests) still yields a working IO, so command constructors can call
// f.Streams() unconditionally. Safe for concurrent use.
func (f *Factory) Streams() *output.IO {
	f.ioOnce.Do(func() {
		f.io = output.NewIO(f.NoColor)
	})
	return f.io
}
