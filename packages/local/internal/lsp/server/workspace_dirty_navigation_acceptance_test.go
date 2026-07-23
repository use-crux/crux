package server

import (
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestWorkspaceNavigationFeaturesSwitchTogetherFromDirtyViewToSavedDiskTruth(t *testing.T) {
	t.Parallel()

	const (
		scopeID      = "scope"
		definitionID = "prompt:writer"
	)
	root := t.TempDir()
	targetFile := navigationTestFile(t, root, "target.ts", "header\nbody\nexport const writer = prompt({});\n")
	usageFile := navigationTestFile(t, root, "usage.ts", "writer\n")
	targetURI := protocol.DocumentURI(mapping.FileURI(root, targetFile))
	usageURI := protocol.DocumentURI(mapping.FileURI(root, usageFile))
	startColumn, endColumn, siteColumn := 14, 20, 1

	definition := navigationTestDefinition(definitionID, targetFile, 3, &startColumn, &endColumn)
	relation := api.ProjectRelation{
		ID: "relation:writer", To: definitionID,
		Source: &api.SourceLoc{File: usageFile, Line: 1, Column: &siteColumn},
	}
	store := readmodel.NewStore()
	store.ApplySnapshot(scopeID, readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{definition},
		Relations:   []api.ProjectRelation{relation},
	})
	publisher := NewPublisher(PublisherOptions{
		ScopeID: scopeID, Root: root, ConfigFile: filepath.Join(root, "crux.config.ts"),
		Store: store, Lines: mapping.NewLineIndex(),
	})
	t.Cleanup(publisher.Close)
	workspace := &workspaceRuntime{sessions: []*scopeSession{{
		scope: readmodel.Scope{ID: scopeID, Root: root}, folderName: "scope", publisher: publisher,
	}}}

	workspace.DidOpen(targetURI, 1)
	zero := protocol.Position{}
	workspace.DidChange(targetURI, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: zero, End: zero}, Text: "\n",
	}})
	shifted := protocol.Range{
		Start: protocol.Position{Line: 3, Character: 13},
		End:   protocol.Position{Line: 3, Character: 19},
	}
	assertWorkspaceNavigationFeatureRanges(t, workspace, usageURI, targetURI, shifted)

	diskDefinition := navigationTestDefinition(definitionID, targetFile, 8, &startColumn, &endColumn)
	changed := store.ApplySnapshot(scopeID, readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{diskDefinition},
		Relations:   []api.ProjectRelation{relation},
	})
	publisher.Change(readmodel.Change{Scope: scopeID, Files: changed, Immediate: true})
	assertWorkspaceNavigationFeatureRanges(t, workspace, usageURI, targetURI, shifted)

	workspace.DidSave(targetURI)
	diskTruth := protocol.Range{
		Start: protocol.Position{Line: 7, Character: 13},
		End:   protocol.Position{Line: 7, Character: 19},
	}
	assertWorkspaceNavigationFeatureRanges(t, workspace, usageURI, targetURI, diskTruth)
}

func assertWorkspaceNavigationFeatureRanges(
	t *testing.T,
	workspace *workspaceRuntime,
	usageURI protocol.DocumentURI,
	targetURI protocol.DocumentURI,
	want protocol.Range,
) {
	t.Helper()

	location, ok := workspace.DefinitionLocation(usageURI, protocol.Position{})
	if !ok || location != (protocol.Location{URI: targetURI, Range: want}) {
		t.Fatalf("definition location = %#v, %v; want %s %#v", location, ok, targetURI, want)
	}

	documentSymbols := workspace.DocumentSymbols(targetURI)
	anchor := protocol.Range{Start: want.Start, End: want.Start}
	if len(documentSymbols) != 1 || documentSymbols[0].Range != want ||
		documentSymbols[0].SelectionRange != anchor {
		t.Fatalf("document symbols = %#v; want range %#v and selection %#v", documentSymbols, want, anchor)
	}

	workspaceSymbols, capped := workspace.WorkspaceSymbols("writer")
	if capped || len(workspaceSymbols) != 1 ||
		workspaceSymbols[0].Location != (protocol.Location{URI: targetURI, Range: want}) {
		t.Fatalf("workspace symbols = %#v, capped %v; want one location %s %#v", workspaceSymbols, capped, targetURI, want)
	}
}
