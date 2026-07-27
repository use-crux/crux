package transient

import (
	"context"
	"errors"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexprompttext "github.com/use-crux/crux/packages/local/internal/projectindex/prompttext"
)

var (
	// ErrUnavailable reports that no exact document or transient analyzer exists.
	ErrUnavailable = errors.New("transient analysis unavailable")
	// ErrSuperseded reports that the document or source changed before a result
	// could be accepted.
	ErrSuperseded = errors.New("transient analysis superseded")
)

// Query identifies both the open document and the active OWN or ATTACHED
// analyzer epoch used for one PromptText analysis.
type Query struct {
	URI            protocol.DocumentURI
	File           string
	ScopeID        string
	SourceEpoch    uint64
	BaseGeneration uint64
	ViewRevision   uint64
	Fragments      []indexprompttext.Fragment
	Analyzer       readmodel.TransientSource
}

// Analysis is normalized evidence accepted for one exact document revision.
type Analysis struct {
	Revision Revision
	Result   readmodel.PromptTextResult
}

type queryKey struct {
	uri            protocol.DocumentURI
	file           string
	scopeID        string
	sourceEpoch    uint64
	baseGeneration uint64
	viewRevision   uint64
	fragmentDigest [32]byte
	revision       Revision
}

type analysisCall struct {
	key      queryKey
	done     chan struct{}
	cancel   context.CancelFunc
	waiters  int
	analysis Analysis
	err      error
}

// Coordinator owns at most one current PromptText result and one in-flight
// compiler query. A newer document or source epoch cancels and supersedes the
// previous query.
type Coordinator struct {
	source Source

	mu       sync.Mutex
	inflight *analysisCall
	cached   *Analysis
	cacheKey queryKey
}

// NewCoordinator creates an exact-result coordinator over the existing
// document-buffer source.
func NewCoordinator(source Source) *Coordinator {
	return &Coordinator{source: source}
}

// Analyze coalesces equal requests and accepts a result only while its
// document revision and OWN/ATTACHED source epoch remain current.
func (c *Coordinator) Analyze(ctx context.Context, query Query) (Analysis, error) {
	if c == nil || c.source == nil || query.Analyzer == nil {
		return Analysis{}, ErrUnavailable
	}
	document, ok := c.source.Snapshot(query.URI)
	if !ok {
		return Analysis{}, ErrUnavailable
	}
	fragments, fragmentDigest, err := indexprompttext.CanonicalizeFragments(
		query.Fragments,
		indexprompttext.DefaultLimits(),
	)
	if err != nil {
		return Analysis{}, err
	}
	key := queryKey{
		uri: query.URI, file: query.File, scopeID: query.ScopeID,
		sourceEpoch:    query.SourceEpoch,
		baseGeneration: query.BaseGeneration,
		viewRevision:   query.ViewRevision,
		fragmentDigest: fragmentDigest,
		revision:       document.Revision,
	}

	c.mu.Lock()
	if c.cached != nil && c.cacheKey == key {
		analysis := *c.cached
		c.mu.Unlock()
		return analysis, nil
	}
	if c.inflight != nil && c.inflight.key == key {
		call := c.inflight
		call.waiters++
		c.mu.Unlock()
		analysis, err := waitForAnalysis(ctx, call)
		if errors.Is(err, context.Canceled) && ctx.Err() == nil {
			return c.Analyze(ctx, query)
		}
		return analysis, err
	}
	if c.inflight != nil {
		c.inflight.cancel()
	}
	queryContext, cancel := context.WithCancel(ctx)
	call := &analysisCall{key: key, done: make(chan struct{}), cancel: cancel}
	c.inflight = call
	c.cached = nil
	c.mu.Unlock()

	result, err := query.Analyzer.PromptText(queryContext, readmodel.PromptTextRequest{
		File: query.File, LanguageID: document.LanguageID,
		Revision: document.Revision, Text: document.Text, Fragments: fragments,
	})
	cancel()
	analysis := Analysis{Revision: document.Revision, Result: result}
	if err == nil && (result.File != query.File || result.Revision != document.Revision) {
		err = ErrSuperseded
	}
	if err == nil {
		current, currentOK := c.source.Snapshot(query.URI)
		if !currentOK || current.Revision != document.Revision {
			err = ErrSuperseded
		}
	}

	c.mu.Lock()
	if c.inflight != call {
		err = ErrSuperseded
	} else {
		c.inflight = nil
		if err == nil {
			c.cacheKey = key
			c.cached = &analysis
		}
	}
	call.analysis = analysis
	call.err = err
	close(call.done)
	c.mu.Unlock()
	return analysis, err
}

func waitForAnalysis(ctx context.Context, call *analysisCall) (Analysis, error) {
	select {
	case <-ctx.Done():
		return Analysis{}, ctx.Err()
	case <-call.done:
		return call.analysis, call.err
	}
}

// Close cancels the current query and drops the cached transient result.
func (c *Coordinator) Close() {
	if c == nil {
		return
	}
	c.mu.Lock()
	if c.inflight != nil {
		c.inflight.cancel()
	}
	c.inflight = nil
	c.cached = nil
	c.mu.Unlock()
}
