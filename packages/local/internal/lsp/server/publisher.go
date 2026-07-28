package server

import (
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

const defaultPublishDebounce = 150 * time.Millisecond

// PublisherOptions supplies one scope's live read model and notification sink.
type PublisherOptions struct {
	ScopeID    string
	Root       string
	ConfigFile string
	Store      *readmodel.Store
	Lines      *mapping.LineIndex
	Notify     func(string, any)
	// SubmitDiagnostics replaces the lint diagnostic lane after Publisher has
	// released its lock. Production supplies the client-session composer.
	SubmitDiagnostics func(protocol.DocumentURI, []protocol.Diagnostic)
	// OnPublish runs after the displayed document views become coherent.
	OnPublish func()
	// Log records malformed or out-of-order client behavior.
	Log func(string)
	// Trace records expected compatibility fallbacks when tracing is enabled.
	Trace    func(string)
	Debounce time.Duration
}

// Publisher maps one scope's complete finding view and emits only changed
// diagnostic sets. Its methods are safe to call from read-model and LSP loops.
type Publisher struct {
	options PublisherOptions
	mapper  *mapping.Mapper

	mu        sync.Mutex
	filter    mapping.FilterOptions
	documents map[protocol.DocumentURI]*publishedDocument
	// fullChangeTraced persists across close/open cycles for the publisher session.
	fullChangeTraced map[protocol.DocumentURI]struct{}
	timer            *time.Timer
	submissions      []diagnosticLaneSubmission
	onPublishPending bool
	closed           bool

	// submissionMu preserves the queue order after the mapping lock is released.
	submissionMu sync.Mutex
}

type diagnosticLaneSubmission struct {
	uri         protocol.DocumentURI
	diagnostics []protocol.Diagnostic
}

// NewPublisher creates a scope-local diagnostic publisher.
func NewPublisher(options PublisherOptions) *Publisher {
	if options.Store == nil {
		options.Store = readmodel.NewStore()
	}
	if options.Lines == nil {
		options.Lines = mapping.NewLineIndex()
	}
	if options.Notify == nil {
		options.Notify = func(string, any) {}
	}
	if options.SubmitDiagnostics == nil {
		options.SubmitDiagnostics = func(
			uri protocol.DocumentURI,
			diagnostics []protocol.Diagnostic,
		) {
			options.Notify(protocol.MethodPublishDiagnostics, protocol.PublishDiagnosticsParams{
				URI: uri, Diagnostics: diagnostics,
			})
		}
	}
	if options.OnPublish == nil {
		options.OnPublish = func() {}
	}
	if options.Log == nil {
		options.Log = func(string) {}
	}
	if options.Trace == nil {
		options.Trace = func(string) {}
	}
	if options.Debounce <= 0 {
		options.Debounce = defaultPublishDebounce
	}
	publisher := &Publisher{
		options:          options,
		documents:        make(map[protocol.DocumentURI]*publishedDocument),
		fullChangeTraced: make(map[protocol.DocumentURI]struct{}),
	}
	publisher.mapper = mapping.New(mapping.Options{
		Root:       options.Root,
		ConfigFile: options.ConfigFile,
		Lines:      options.Lines,
	})
	return publisher
}

// Change schedules or immediately publishes a read-model replacement.
func (p *Publisher) Change(change readmodel.Change) {
	if change.Scope != p.options.ScopeID {
		return
	}
	for _, file := range change.Files {
		p.options.Lines.Invalidate(p.sourcePath(file))
	}

	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	if change.Immediate {
		p.stopTimerLocked()
		p.publishLocked("", true)
		p.mu.Unlock()
		p.flushDiagnosticSubmissions()
		return
	}
	if p.timer != nil {
		p.timer.Stop()
	}
	p.timer = time.AfterFunc(p.options.Debounce, p.publishDebounced)
	p.mu.Unlock()
}

// UpdateFilter immediately republishes diagnostics affected by editor settings.
func (p *Publisher) UpdateFilter(filter mapping.FilterOptions) {
	p.mu.Lock()
	if p.closed || p.filter == filter {
		p.mu.Unlock()
		return
	}
	p.filter = filter
	p.stopTimerLocked()
	p.publishLocked("", true)
	p.mu.Unlock()
	p.flushDiagnosticSubmissions()
}

// DidOpen rebuilds the document's authoritative view and immediately
// republishes its diagnostics, even when their hash is unchanged.
func (p *Publisher) DidOpen(uri protocol.DocumentURI, version int) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	document := p.documentLocked(uri)
	document.open = true
	document.version = version
	document.hasVersion = true
	document.dirty = false
	document.held = nil
	// Recompute every URI as an authoritative view while forcing only the
	// opened document. Other dirty documents must retain buffer-space ranges.
	p.publishLocked(uri, true)
	p.mu.Unlock()
	p.flushDiagnosticSubmissions()
}

// DidChange shifts the currently displayed diagnostics and navigation view
// without consulting disk or the Project Index. Regressive versions and
// changes for closed documents are ignored.
func (p *Publisher) DidChange(uri protocol.DocumentURI, version int, changes []protocol.TextDocumentContentChangeEvent) {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	document, ok := p.documents[uri]
	if !ok || !document.open {
		p.mu.Unlock()
		return
	}
	if document.hasVersion && version <= document.version {
		p.options.Log(fmt.Sprintf(
			"ignored didChange version %d for %s; tracked version is %d",
			version,
			uri,
			document.version,
		))
		p.mu.Unlock()
		return
	}
	document.version = version
	document.hasVersion = true
	document.dirty = true
	if hasFullDocumentChange(changes) {
		if _, traced := p.fullChangeTraced[uri]; !traced {
			p.fullChangeTraced[uri] = struct{}{}
			p.options.Trace(fmt.Sprintf(
				"full-document didChange for %s cannot shift diagnostics; positions will reset after save",
				uri,
			))
		}
	}
	transformed, diagnosticsChanged, navigationChanged := transformDocumentView(uri, document.view, changes)
	if diagnosticsChanged {
		p.setDisplayedLocked(uri, transformed, true)
	} else if navigationChanged {
		document.view = transformed
	}
	p.mu.Unlock()
	p.flushDiagnosticSubmissions()
}

// DidSave invalidates cached source lines, applies the newest held
// authoritative view, or resets navigation positions to current disk truth.
func (p *Publisher) DidSave(uri protocol.DocumentURI) {
	if file, err := mapping.URIToPath(string(uri)); err == nil {
		p.options.Lines.Invalidate(file)
	}
	p.mu.Lock()
	document, ok := p.documents[uri]
	if !ok {
		p.mu.Unlock()
		return
	}
	document.dirty = false
	if document.held != nil {
		held := cloneDocumentView(*document.held)
		document.held = nil
		p.setDisplayedLocked(uri, held, false)
		p.onPublishPending = true
		p.mu.Unlock()
		p.flushDiagnosticSubmissions()
		return
	}
	publication := p.options.Store.PublicationSnapshot(p.options.ScopeID)
	diskView := p.currentDocumentView(uri, publication, document.view.diagnostics, document.view.findings)
	document.view.definitions = diskView.definitions
	document.view.relationCounts = diskView.relationCounts
	document.view.sites = diskView.sites
	p.mu.Unlock()
	p.flushDiagnosticSubmissions()
}

// DidClose drops buffer-tracking metadata while leaving workspace diagnostics
// visible until the next authoritative update.
func (p *Publisher) DidClose(uri protocol.DocumentURI) {
	p.mu.Lock()
	document, ok := p.documents[uri]
	if !ok {
		p.mu.Unlock()
		return
	}
	document.open = false
	document.version = 0
	document.hasVersion = false
	document.dirty = false
	document.held = nil
	document.view.definitions = nil
	document.view.relationCounts = nil
	document.view.sites = nil
	p.deleteDocumentIfIdleLocked(uri, document)
	p.mu.Unlock()
	p.flushDiagnosticSubmissions()
}

// LeadingWhitespace reads indentation for a zero-based LSP source line.
func (p *Publisher) LeadingWhitespace(uri protocol.DocumentURI, line uint32) string {
	file, err := mapping.URIToPath(string(uri))
	if err != nil {
		return ""
	}
	return p.options.Lines.LeadingWhitespace(file, int(line)+1)
}

// Close cancels pending work without clearing editor-owned diagnostics.
func (p *Publisher) Close() {
	p.mu.Lock()
	p.closed = true
	p.stopTimerLocked()
	p.mu.Unlock()
}

func (p *Publisher) sourcePath(file string) string {
	if file == "" {
		return p.options.ConfigFile
	}
	if filepath.IsAbs(file) {
		return file
	}
	return filepath.Join(p.options.Root, file)
}
