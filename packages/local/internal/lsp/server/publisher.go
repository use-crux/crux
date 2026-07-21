package server

import (
	"crypto/sha256"
	"encoding/json"
	"path/filepath"
	"sort"
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
	Debounce   time.Duration
}

// Publisher maps one scope's complete finding view and emits only changed
// diagnostic sets. Its methods are safe to call from read-model and LSP loops.
type Publisher struct {
	options PublisherOptions
	mapper  *mapping.Mapper

	mu        sync.Mutex
	filter    mapping.FilterOptions
	published map[protocol.DocumentURI][sha256.Size]byte
	timer     *time.Timer
	closed    bool
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
	if options.Debounce <= 0 {
		options.Debounce = defaultPublishDebounce
	}
	publisher := &Publisher{
		options:   options,
		published: make(map[protocol.DocumentURI][sha256.Size]byte),
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
		p.publishLocked("")
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
	p.publishLocked("")
}

// DidOpen immediately republishes a document, even when its hash is unchanged.
func (p *Publisher) DidOpen(uri protocol.DocumentURI) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return
	}
	p.publishLocked(uri)
}

// DidSave invalidates cached source lines before the next mapping pass.
func (p *Publisher) DidSave(uri protocol.DocumentURI) {
	if file, err := mapping.URIToPath(string(uri)); err == nil {
		p.options.Lines.Invalidate(file)
	}
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
	p.publishLocked("")
}

func (p *Publisher) publishLocked(force protocol.DocumentURI) {
	diagnostics := p.currentDiagnostics()
	uris := make(map[protocol.DocumentURI]struct{}, len(diagnostics)+len(p.published)+1)
	for uri := range diagnostics {
		uris[uri] = struct{}{}
	}
	for uri := range p.published {
		uris[uri] = struct{}{}
	}
	if force != "" {
		uris[force] = struct{}{}
	}
	ordered := make([]string, 0, len(uris))
	for uri := range uris {
		ordered = append(ordered, string(uri))
	}
	sort.Strings(ordered)
	for _, value := range ordered {
		uri := protocol.DocumentURI(value)
		current := diagnostics[uri]
		if current == nil {
			current = []protocol.Diagnostic{}
		}
		hash := diagnosticHash(current)
		previous, exists := p.published[uri]
		if uri != force && exists && previous == hash {
			continue
		}
		if uri != force && !exists && len(current) == 0 {
			continue
		}
		p.options.Notify(protocol.MethodPublishDiagnostics, protocol.PublishDiagnosticsParams{
			URI: uri, Diagnostics: current,
		})
		if len(current) == 0 {
			delete(p.published, uri)
		} else {
			p.published[uri] = hash
		}
	}
}

func (p *Publisher) currentDiagnostics() map[protocol.DocumentURI][]protocol.Diagnostic {
	anchors := p.options.Store.AllFindings(p.options.ScopeID)
	findings := make([]api.IndexLintFinding, 0)
	for _, values := range anchors {
		findings = append(findings, values...)
	}
	return p.mapper.MapFindings(mapping.FilterFindings(findings, p.filter))
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

func diagnosticHash(diagnostics []protocol.Diagnostic) [sha256.Size]byte {
	payload, _ := json.Marshal(diagnostics)
	return sha256.Sum256(payload)
}
