// Package cli provides application-level wiring for the crux CLI.
// It holds the [Factory] which is the single dependency container
// passed to all Cobra command constructors.
package cli

import (
	"sync"

	"github.com/use-crux/crux/packages/local/internal/api"
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

	clientOnce sync.Once
	client     *api.Client
}

// Client returns the API client for the devtools server, creating it on first
// call. The client targets http://localhost:{Port}. Safe for concurrent use.
func (f *Factory) Client() *api.Client {
	f.clientOnce.Do(func() {
		f.client = api.NewDefault(f.Port)
	})
	return f.client
}
