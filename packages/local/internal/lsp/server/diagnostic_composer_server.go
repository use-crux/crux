package server

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func newServerDiagnosticComposer(server *Server) *diagnosticComposer {
	return newDiagnosticComposer(diagnosticComposerOptions{
		Document: server.captureDiagnosticDocument,
		VersionSupport: func() bool {
			server.mu.Lock()
			defer server.mu.Unlock()
			return server.diagnosticVersionSupport
		},
		Publish: func(params protocol.PublishDiagnosticsParams) {
			server.Notify(
				context.Background(),
				protocol.MethodPublishDiagnostics,
				params,
			)
		},
	})
}
