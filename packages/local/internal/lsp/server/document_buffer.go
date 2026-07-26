package server

import (
	"sync"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
)

const (
	defaultDocumentBufferBytes = 2 << 20
	defaultProcessBufferBytes  = 32 << 20
)

type documentBufferLimits struct {
	DocumentBytes int
	ProcessBytes  int
}

type documentBufferLimitNotice struct {
	URI           protocol.DocumentURI
	Reason        string
	DocumentBytes int
	ProcessBytes  int
	LimitBytes    int
}

type documentSnapshot = transient.Document

type documentBuffers struct {
	mu         sync.Mutex
	limits     documentBufferLimits
	documents  map[protocol.DocumentURI]bufferDocument
	totalBytes int
	openEpochs map[protocol.DocumentURI]uint64
}

type bufferDocument struct {
	snapshot    documentSnapshot
	available   bool
	limitTraced bool
}

func newDocumentBuffers(limits documentBufferLimits) *documentBuffers {
	return &documentBuffers{
		limits: limits, documents: make(map[protocol.DocumentURI]bufferDocument),
		openEpochs: make(map[protocol.DocumentURI]uint64),
	}
}

func (b *documentBuffers) Open(item protocol.TextDocumentItem) *documentBufferLimitNotice {
	b.mu.Lock()
	b.removeBytesLocked(b.documents[item.URI])
	b.openEpochs[item.URI]++
	if !completionLanguage(item.LanguageID) {
		delete(b.documents, item.URI)
		b.mu.Unlock()
		return nil
	}
	document := bufferDocument{
		snapshot: documentSnapshot{
			URI: item.URI, LanguageID: item.LanguageID, Version: item.Version, Text: item.Text,
			Revision: transient.Revision{
				OpenEpoch: b.openEpochs[item.URI], Version: int64(item.Version),
			},
		},
		available: b.withinLimitsLocked(len(item.Text)),
	}
	var notice *documentBufferLimitNotice
	if document.available {
		document.snapshot.Revision = transient.NewRevision(
			b.openEpochs[item.URI],
			item.Version,
			item.Text,
		)
		b.totalBytes += len(item.Text)
	} else {
		notice = b.limitNoticeLocked(item.URI, len(item.Text), b.totalBytes+len(item.Text))
		document.limitTraced = true
		document.snapshot.Text = ""
	}
	b.documents[item.URI] = document
	b.mu.Unlock()
	return notice
}

func completionLanguage(languageID string) bool {
	switch languageID {
	case "typescript", "typescriptreact", "javascript", "javascriptreact":
		return true
	default:
		return false
	}
}

func (b *documentBuffers) Snapshot(uri protocol.DocumentURI) (documentSnapshot, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	document, ok := b.documents[uri]
	if !ok || !document.available {
		return documentSnapshot{}, false
	}
	return document.snapshot, true
}

func (b *documentBuffers) Close(uri protocol.DocumentURI) {
	b.mu.Lock()
	b.removeBytesLocked(b.documents[uri])
	delete(b.documents, uri)
	b.mu.Unlock()
}

func (b *documentBuffers) Clear() {
	b.mu.Lock()
	b.documents = make(map[protocol.DocumentURI]bufferDocument)
	b.totalBytes = 0
	b.mu.Unlock()
}

func (b *documentBuffers) withinLimitsLocked(bytes int) bool {
	return bytes <= b.limits.DocumentBytes && b.totalBytes+bytes <= b.limits.ProcessBytes
}

func (b *documentBuffers) limitNoticeLocked(
	uri protocol.DocumentURI,
	documentBytes int,
	processBytes int,
) *documentBufferLimitNotice {
	notice := &documentBufferLimitNotice{
		URI: uri, DocumentBytes: documentBytes, ProcessBytes: processBytes,
	}
	if documentBytes > b.limits.DocumentBytes {
		notice.Reason = "document_limit"
		notice.LimitBytes = b.limits.DocumentBytes
	} else {
		notice.Reason = "process_limit"
		notice.LimitBytes = b.limits.ProcessBytes
	}
	return notice
}

func (b *documentBuffers) removeBytesLocked(document bufferDocument) {
	if document.available {
		b.totalBytes -= len(document.snapshot.Text)
	}
}
