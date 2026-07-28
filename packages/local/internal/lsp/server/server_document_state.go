package server

import "github.com/use-crux/crux/packages/local/internal/lsp/protocol"

// captureDiagnosticDocument obtains the open-document identity from the same
// critical section used by didOpen, didChange, and didClose. A diagnostic
// publication therefore cannot combine one buffer revision with another LSP
// version or lifecycle state.
func (s *Server) captureDiagnosticDocument(
	uri protocol.DocumentURI,
) diagnosticDocumentState {
	s.mu.Lock()
	defer s.mu.Unlock()
	status := s.documents[uri]
	document, exact := s.buffers.Snapshot(uri)
	return diagnosticDocumentState{
		Revision: document.Revision,
		Version:  status.Version,
		Exact:    exact,
		Open:     status.Open,
	}
}

func (s *Server) openDocument(
	item protocol.TextDocumentItem,
) *documentBufferLimitNotice {
	s.mu.Lock()
	defer s.mu.Unlock()
	notice := s.buffers.Open(item)
	status := s.documents[item.URI]
	status.Open = true
	status.Version = item.Version
	s.documents[item.URI] = status
	return notice
}

func (s *Server) changeDocument(
	params protocol.DidChangeTextDocumentParams,
) *documentBufferLimitNotice {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, notice := s.buffers.ApplyChanges(
		params.TextDocument.URI,
		params.TextDocument.Version,
		params.ContentChanges,
	)
	if version, ok := s.buffers.Version(params.TextDocument.URI); ok {
		status := s.documents[params.TextDocument.URI]
		if status.Open {
			status.Version = version
			s.documents[params.TextDocument.URI] = status
		}
	}
	return notice
}

func (s *Server) closeDocument(uri protocol.DocumentURI) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.buffers.Close(uri)
	status := s.documents[uri]
	status.Open = false
	status.Version = 0
	s.documents[uri] = status
}
