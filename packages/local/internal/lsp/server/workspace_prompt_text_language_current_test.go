package server

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

func TestPromptTextLanguageFinalValidationRejectsPublicationAndSourceAdvance(
	t *testing.T,
) {
	t.Parallel()

	const scope = "scope"
	root := t.TempDir()
	source := "const value = md`hello`;\n"
	file := navigationTestFile(t, root, "source.ts", source)
	uri := protocol.DocumentURI(mapping.FileURI(root, file))
	generation := uint64(1)
	store := readmodel.NewStore()
	store.ApplySnapshot(scope, promptTextViewSnapshot(
		generation,
		file,
		source,
		1,
	))
	server := New(Options{})
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1, Text: source,
	})
	document, ok := server.buffers.Snapshot(uri)
	if !ok {
		t.Fatal("document unavailable")
	}
	saved := indexview.NewSavedProvider(store)
	views := promptview.NewProvider(saved, promptview.Options{Root: root})
	revision := promptTextViewRevision(document)
	if !views.Open(promptview.Request{
		ScopeID: scope, File: file, Document: &revision,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	}) {
		t.Fatal("exact transform was not established")
	}
	selection := views.Select(context.Background(), promptview.Request{
		ScopeID: scope, File: file, Document: &revision,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	})
	session := &scopeSession{
		scope: scopeForPromptTextTest(scope, root),
		mode:  readmodel.ModeOwn, transient: lifecyclePromptTextSource{},
		sourceEpoch: 1, promptTextViews: views,
	}
	workspace := &workspaceRuntime{server: server, store: store}

	if !workspace.promptTextLanguageResultCurrent(
		session,
		uri,
		1,
		views,
		document.Revision,
		selection.View.Stamp,
		[]string{file},
		selection.View.Documents,
	) {
		t.Fatal("current language result was rejected")
	}

	session.promptTextTransition.Lock()
	generation++
	store.ApplySnapshot(scope, promptTextViewSnapshot(
		generation,
		file,
		source,
		1,
	))
	session.promptTextTransition.Unlock()
	if workspace.promptTextLanguageResultCurrent(
		session,
		uri,
		1,
		views,
		document.Revision,
		selection.View.Stamp,
		[]string{file},
		selection.View.Documents,
	) {
		t.Fatal("stale project stamp passed response-bound validation")
	}

	selection = views.Select(context.Background(), promptview.Request{
		ScopeID: scope, File: file, Document: &revision,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	})
	session.promptTextTransition.Lock()
	session.sourceEpoch++
	session.promptTextTransition.Unlock()
	if workspace.promptTextLanguageResultCurrent(
		session,
		uri,
		1,
		views,
		document.Revision,
		selection.View.Stamp,
		[]string{file},
		selection.View.Documents,
	) {
		t.Fatal("stale source epoch passed response-bound validation")
	}
}

func TestPromptTextDestinationStampRejectsBufferAdvanceBeforeViewChange(
	t *testing.T,
) {
	t.Parallel()

	root := t.TempDir()
	const source = "const value = md`hello`;\n"
	file := navigationTestFile(t, root, "destination.ts", source)
	uri := protocol.DocumentURI(mapping.FileURI(root, file))
	server := New(Options{})
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1, Text: source,
	})
	document, ok := server.buffers.Snapshot(uri)
	if !ok {
		t.Fatal("destination document unavailable")
	}
	workspace := &workspaceRuntime{server: server}
	session := &scopeSession{scope: scopeForPromptTextTest("scope", root)}
	documents := []promptview.DocumentStamp{{
		File: file, Revision: promptTextViewRevision(document),
		TransformRevision: 7,
	}}

	if !workspace.promptTextDocumentStampsCurrent(
		session,
		7,
		[]string{file},
		documents,
	) {
		t.Fatal("current destination stamp was rejected")
	}
	server.buffers.Change(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Text: source + "\n",
	}})
	if workspace.promptTextDocumentStampsCurrent(
		session,
		7,
		[]string{file},
		documents,
	) {
		t.Fatal("destination buffer advance passed before its view transform changed")
	}
}

func TestPromptTextClosedDestinationMustRemainClosedUntilFinalValidation(
	t *testing.T,
) {
	t.Parallel()

	root := t.TempDir()
	const source = "const value = md`hello`;\n"
	file := navigationTestFile(t, root, "destination.ts", source)
	uri := protocol.DocumentURI(mapping.FileURI(root, file))
	server := New(Options{})
	workspace := &workspaceRuntime{server: server}
	session := &scopeSession{scope: scopeForPromptTextTest("scope", root)}

	if !workspace.promptTextDocumentStampsCurrent(
		session,
		7,
		[]string{file},
		nil,
	) {
		t.Fatal("closed destination state was rejected")
	}
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1, Text: source + "\n",
	})
	if workspace.promptTextDocumentStampsCurrent(
		session,
		7,
		[]string{file},
		nil,
	) {
		t.Fatal("newly opened dirty destination passed as the selected closed state")
	}
}

func scopeForPromptTextTest(id, root string) readmodel.Scope {
	return readmodel.Scope{ID: id, Root: root}
}
