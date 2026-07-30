package server

import (
	"bytes"
	"encoding/json"
	"sort"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

type diagnosticComposerOptions struct {
	Document       func(protocol.DocumentURI) diagnosticDocumentState
	VersionSupport func() bool
	Publish        func(protocol.PublishDiagnosticsParams)
}

type diagnosticDocumentState struct {
	Revision transient.Revision
	Version  int
	Exact    bool
	Open     bool
}

type diagnosticComposerLane struct {
	lint            []protocol.Diagnostic
	promptText      []protocol.Diagnostic
	promptTextStamp *promptTextDiagnosticStamp
}

type promptTextDiagnosticStamp struct {
	Revision          transient.Revision
	SourceEpoch       uint64
	ViewStamp         indexview.ViewStamp
	RequestGeneration uint64
}

// diagnosticComposer is the sole client-session owner of complete diagnostic
// replacements. Independent lanes are combined only while holding this lock,
// which preserves submission and notification order.
type diagnosticComposer struct {
	options diagnosticComposerOptions

	mu    sync.Mutex
	lanes map[protocol.DocumentURI]diagnosticComposerLane
}

func newDiagnosticComposer(options diagnosticComposerOptions) *diagnosticComposer {
	if options.Document == nil {
		options.Document = func(protocol.DocumentURI) diagnosticDocumentState {
			return diagnosticDocumentState{}
		}
	}
	if options.VersionSupport == nil {
		options.VersionSupport = func() bool { return true }
	}
	if options.Publish == nil {
		options.Publish = func(protocol.PublishDiagnosticsParams) {}
	}
	return &diagnosticComposer{
		options: options,
		lanes:   make(map[protocol.DocumentURI]diagnosticComposerLane),
	}
}

func (c *diagnosticComposer) SubmitLint(
	uri protocol.DocumentURI,
	diagnostics []protocol.Diagnostic,
) {
	c.mu.Lock()
	defer c.mu.Unlock()
	lane := c.lanes[uri]
	lane.lint = cloneDiagnostics(diagnostics)
	c.lanes[uri] = lane
	c.publishLocked(uri, lane)
}

func (c *diagnosticComposer) SubmitPromptText(
	uri protocol.DocumentURI,
	stamp promptTextDiagnosticStamp,
	diagnostics []protocol.Diagnostic,
) {
	c.mu.Lock()
	defer c.mu.Unlock()
	lane := c.lanes[uri]
	lane.promptText = sortedPromptTextDiagnostics(diagnostics)
	lane.promptTextStamp = &stamp
	c.lanes[uri] = lane
	c.publishLocked(uri, lane)
}

func (c *diagnosticComposer) ClearPromptText(uri protocol.DocumentURI) {
	c.mu.Lock()
	defer c.mu.Unlock()
	lane := c.lanes[uri]
	lane.promptText = nil
	lane.promptTextStamp = nil
	c.lanes[uri] = lane
	c.publishLocked(uri, lane)
}

func (c *diagnosticComposer) publishLocked(
	uri protocol.DocumentURI,
	lane diagnosticComposerLane,
) {
	document := c.options.Document(uri)
	diagnostics := cloneDiagnostics(lane.lint)
	if document.Open && document.Exact && c.options.VersionSupport() &&
		lane.promptTextStamp != nil &&
		lane.promptTextStamp.Revision == document.Revision {
		diagnostics = append(diagnostics, cloneDiagnostics(lane.promptText)...)
	}
	if diagnostics == nil {
		diagnostics = []protocol.Diagnostic{}
	}
	var version *int
	if document.Open {
		value := document.Version
		version = &value
	}
	c.options.Publish(protocol.PublishDiagnosticsParams{
		URI: uri, Version: version, Diagnostics: diagnostics,
	})
}

func sortedPromptTextDiagnostics(
	diagnostics []protocol.Diagnostic,
) []protocol.Diagnostic {
	result := cloneDiagnostics(diagnostics)
	sort.SliceStable(result, func(left, right int) bool {
		l, r := result[left], result[right]
		if value := compareDiagnosticRange(l.Range, r.Range); value != 0 {
			return value < 0
		}
		if l.Code != r.Code {
			return l.Code < r.Code
		}
		return bytes.Compare(
			[]byte(promptTextDiagnosticID(l)),
			[]byte(promptTextDiagnosticID(r)),
		) < 0
	})
	return result
}

func compareDiagnosticRange(left, right protocol.Range) int {
	if value := comparePosition(left.Start, right.Start); value != 0 {
		return value
	}
	return comparePosition(left.End, right.End)
}

func promptTextDiagnosticID(diagnostic protocol.Diagnostic) string {
	var data struct {
		Kind string `json:"kind"`
		ID   string `json:"id"`
	}
	if json.Unmarshal(diagnostic.Data, &data) != nil ||
		data.Kind != "prompt-text" {
		return ""
	}
	return data.ID
}
