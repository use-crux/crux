package server

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestPromptTextDiagnosticSaveRetiresAcceptedViewNotNewGeneration(
	t *testing.T,
) {
	t.Parallel()

	_, workspace, session, recorder, uri := newPromptTextSourceHarness(
		t,
		lifecyclePromptTextSource{},
	)
	workspace.resetPromptTextDiagnostics(session, uri, true)
	recorder.waitFor(t, hasPromptTextDiagnosticVersion(7))

	next := promptTextDiagnosticSnapshot(
		"const value = md`Hello ${true}`\n",
	)
	generation := uint64(2)
	next.Generation = &generation
	workspace.store.ApplySnapshot("/repo", next)

	beforeSave := recorder.count()
	workspace.savePromptTextDiagnostics(session, uri)
	_, clearIndex := recorder.waitForAfter(
		t,
		beforeSave,
		func(params protocol.PublishDiagnosticsParams) bool {
			return params.Version != nil &&
				*params.Version == 7 &&
				len(params.Diagnostics) == 0
		},
	)
	recorder.waitForAfter(
		t,
		clearIndex+1,
		hasPromptTextDiagnosticVersion(7),
	)
}

func hasPromptTextDiagnosticVersion(
	version int,
) func(protocol.PublishDiagnosticsParams) bool {
	return func(params protocol.PublishDiagnosticsParams) bool {
		return params.Version != nil &&
			*params.Version == version &&
			len(params.Diagnostics) == 1
	}
}
