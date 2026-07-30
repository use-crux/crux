package transient

import "github.com/use-crux/crux/packages/local/internal/lsp/protocol"

// Document is an immutable view of bytes retained by the existing LSP buffer.
// Copying it copies only the Go string header; the coordinator does not create
// another source-text owner.
type Document struct {
	URI        protocol.DocumentURI
	LanguageID string
	Version    int
	Text       string
	Revision   Revision
}

// Source returns the current exact snapshot for an open document.
type Source interface {
	Snapshot(protocol.DocumentURI) (Document, bool)
}
