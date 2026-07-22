package server

import (
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
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
	closed           bool
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
		Definition: func(id string) (api.ProjectDefinition, bool) {
			return options.Store.Definition(options.ScopeID, id)
		},
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
	defer p.mu.Unlock()
	if p.closed {
		return
	}
	if change.Immediate {
		p.stopTimerLocked()
		p.publishLocked("", true)
		return
	}
	if p.timer != nil {
		p.timer.Stop()
	}
	p.timer = time.AfterFunc(p.options.Debounce, p.publishDebounced)
}

// UpdateFilter immediately republishes diagnostics affected by editor settings.
func (p *Publisher) UpdateFilter(filter mapping.FilterOptions) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed || p.filter == filter {
		return
	}
	p.filter = filter
	p.stopTimerLocked()
	p.publishLocked("", true)
}

// DidOpen immediately republishes a document, even when its hash is unchanged.
func (p *Publisher) DidOpen(uri protocol.DocumentURI, version int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return
	}
	document := p.documentLocked(uri)
	document.open = true
	document.version = version
	document.hasVersion = true
	document.dirty = false
	document.held = nil
	document.heldFindings = nil
	document.hasHeld = false
	// Recompute every URI as an authoritative view while forcing only the
	// opened document. Other dirty documents must retain buffer-space ranges.
	p.publishLocked(uri, true)
}

// DidChange shifts the currently displayed diagnostics without consulting disk
// or the Project Index. Regressive versions and changes for closed documents
// are ignored.
func (p *Publisher) DidChange(uri protocol.DocumentURI, version int, changes []protocol.TextDocumentContentChangeEvent) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return
	}
	document, ok := p.documents[uri]
	if !ok || !document.open {
		return
	}
	if document.hasVersion && version <= document.version {
		p.options.Log(fmt.Sprintf(
			"ignored didChange version %d for %s; tracked version is %d",
			version,
			uri,
			document.version,
		))
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
	transformed, changed := applyDocumentChanges(uri, document.diagnostics, changes)
	if changed {
		p.setDisplayedLocked(uri, transformed, document.findings, true)
	}
}

// DidSave invalidates cached source lines and applies the newest authoritative
// view held while the document was dirty.
func (p *Publisher) DidSave(uri protocol.DocumentURI) {
	if file, err := mapping.URIToPath(string(uri)); err == nil {
		p.options.Lines.Invalidate(file)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	document, ok := p.documents[uri]
	if !ok {
		return
	}
	document.dirty = false
	if document.hasHeld {
		held := document.held
		heldFindings := document.heldFindings
		document.held = nil
		document.heldFindings = nil
		document.hasHeld = false
		p.setDisplayedLocked(uri, held, heldFindings, false)
	}
}

// DidClose drops buffer-tracking metadata while leaving workspace diagnostics
// visible until the next authoritative update.
func (p *Publisher) DidClose(uri protocol.DocumentURI) {
	p.mu.Lock()
	defer p.mu.Unlock()
	document, ok := p.documents[uri]
	if !ok {
		return
	}
	document.open = false
	document.version = 0
	document.hasVersion = false
	document.dirty = false
	document.held = nil
	document.heldFindings = nil
	document.hasHeld = false
	p.deleteDocumentIfIdleLocked(uri, document)
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

func (p *Publisher) publishDebounced() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return
	}
	p.timer = nil
	p.publishLocked("", true)
}

func (p *Publisher) currentDiagnostics() (
	map[protocol.DocumentURI][]protocol.Diagnostic,
	map[string]api.IndexLintFinding,
) {
	anchors := p.options.Store.AllFindings(p.options.ScopeID)
	findings := make([]api.IndexLintFinding, 0)
	for _, values := range anchors {
		findings = append(findings, values...)
	}
	filtered := mapping.FilterFindings(findings, p.filter)
	byID := make(map[string]api.IndexLintFinding, len(filtered))
	for _, finding := range filtered {
		byID[finding.ID] = finding
	}
	return p.mapper.MapFindings(filtered), byID
}

func (p *Publisher) stopTimerLocked() {
	if p.timer != nil {
		p.timer.Stop()
		p.timer = nil
	}
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
