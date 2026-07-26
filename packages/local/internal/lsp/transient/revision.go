// Package transient coordinates exact, cache-bypassing analysis of open
// documents. Source bytes stay owned by the LSP document buffer.
package transient

import (
	"github.com/use-crux/crux/packages/local/internal/projectindex/sourcehash"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

// Revision identifies one exact lifetime and byte state of an open document.
type Revision = staticprotocol.PromptTextDocumentRevision

// NewRevision stamps exact source bytes within one open-document lifetime.
func NewRevision(openEpoch uint64, version int, text string) Revision {
	return Revision{
		OpenEpoch:  openEpoch,
		Version:    int64(version),
		SourceHash: sourcehash.Sum([]byte(text)),
	}
}
