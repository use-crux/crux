package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestWorkspaceNavigationResolvesRelationsSourceRefsAndSelfJumps(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	targetFile := navigationTestFile(t, root, "target.ts", "export const writer = prompt({});\nwriter();\n")
	fallbackFile := navigationTestFile(t, root, "fallback.ts", "first\nfallback\n")
	relationFile := navigationTestFile(t, root, "usage.ts", "first\nwriter\nlast\n")
	refFile := navigationTestFile(t, root, "schema.ts", "writerInput\nlast\n")
	start, end, siteColumn := 14, 20, 1
	target := navigationTestDefinition("prompt:writer", targetFile, 1, &start, &end)
	target.SourceRefs = []api.ProjectSourceRef{{
		ID: "ref:writer-input", Role: "input", Source: api.SourceLoc{File: refFile, Line: 1, Column: &siteColumn},
	}}
	fallback := api.ProjectDefinition{
		ID: "tool:fallback", Kind: "tool", Name: "fallback",
		Source: &api.SourceLoc{File: fallbackFile, Line: 2, Column: &siteColumn},
	}
	snapshot := readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{target, fallback},
		Relations: []api.ProjectRelation{
			{
				ID: "relation:writer", To: target.ID,
				Source: &api.SourceLoc{File: relationFile, Line: 2, Column: &siteColumn},
			},
			{
				ID: "relation:fallback", To: fallback.ID,
				Source: &api.SourceLoc{File: relationFile, Line: 3, Column: &siteColumn},
			},
		},
	}
	publisher := navigationTestPublisher(t, "scope", root, snapshot)
	workspace := &workspaceRuntime{sessions: []*scopeSession{{
		scope: readmodel.Scope{ID: "scope", Root: root}, publisher: publisher,
	}}}
	targetURI := protocol.DocumentURI(mapping.FileURI(root, targetFile))
	wantTarget := protocol.Location{
		URI: targetURI,
		Range: protocol.Range{
			Start: protocol.Position{Line: 0, Character: 13},
			End:   protocol.Position{Line: 0, Character: 19},
		},
	}

	for name, request := range map[string]struct {
		uri      protocol.DocumentURI
		position protocol.Position
	}{
		"relation":   {protocol.DocumentURI(mapping.FileURI(root, relationFile)), protocol.Position{Line: 1}},
		"source ref": {protocol.DocumentURI(mapping.FileURI(root, refFile)), protocol.Position{}},
	} {
		t.Run(name, func(t *testing.T) {
			got, ok := workspace.DefinitionLocation(request.uri, request.position)
			if !ok || got != wantTarget {
				t.Fatalf("DefinitionLocation = %#v, %v; want %#v", got, ok, wantTarget)
			}
		})
	}
	if got, ok := workspace.DefinitionLocation(targetURI, protocol.Position{Line: 0, Character: 14}); ok {
		t.Fatalf("self definition jump = %#v, want miss", got)
	}
	fallbackLocation, ok := workspace.DefinitionLocation(
		protocol.DocumentURI(mapping.FileURI(root, relationFile)),
		protocol.Position{Line: 2},
	)
	if want := (protocol.Location{
		URI:   protocol.DocumentURI(mapping.FileURI(root, fallbackFile)),
		Range: protocol.Range{Start: protocol.Position{Line: 1}, End: protocol.Position{Line: 2}},
	}); !ok || fallbackLocation != want {
		t.Fatalf("fallback definition location = %#v, %v; want %#v", fallbackLocation, ok, want)
	}

	references := workspace.ReferenceLocations(targetURI, protocol.Position{Line: 0, Character: 14}, false)
	if len(references) != 2 {
		t.Fatalf("references = %#v, want source ref and relation", references)
	}
	for _, location := range references {
		if location.Range.Start.Character != 0 || location.Range.End.Character != 0 ||
			location.Range.End.Line != location.Range.Start.Line+1 {
			t.Fatalf("reference location is not whole-line: %#v", location)
		}
	}
	withDeclaration := workspace.ReferenceLocations(targetURI, protocol.Position{Line: 0, Character: 14}, true)
	if len(withDeclaration) != 3 || withDeclaration[0] != wantTarget {
		t.Fatalf("references with declaration = %#v; want declaration prepended", withDeclaration)
	}
}

func TestWorkspaceNavigationUsesMostSpecificContainingScope(t *testing.T) {
	t.Parallel()

	parent := t.TempDir()
	child := filepath.Join(parent, "child")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatal(err)
	}
	childFile := navigationTestFile(t, child, "usage.ts", "writer\n")
	parentTarget := navigationTestFile(t, parent, "target.ts", "writer\n")
	column := 1
	parentSnapshot := readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{navigationTestDefinition("prompt:parent", parentTarget, 1, &column, nil)},
		Relations: []api.ProjectRelation{{
			ID: "relation:parent", To: "prompt:parent",
			Source: &api.SourceLoc{File: childFile, Line: 1, Column: &column},
		}},
	}
	parentPublisher := navigationTestPublisher(t, "parent", parent, parentSnapshot)
	childPublisher := navigationTestPublisher(t, "child", child, readmodel.Snapshot{})
	workspace := &workspaceRuntime{sessions: []*scopeSession{
		{scope: readmodel.Scope{ID: "parent", Root: parent}, publisher: parentPublisher},
		{scope: readmodel.Scope{ID: "child", Root: child}, publisher: childPublisher},
	}}
	uri := protocol.DocumentURI(mapping.FileURI(child, childFile))
	if location, ok := workspace.DefinitionLocation(uri, protocol.Position{}); ok {
		t.Fatalf("nested navigation leaked parent scope location %#v", location)
	}
}

func navigationTestPublisher(t *testing.T, scope, root string, snapshot readmodel.Snapshot) *Publisher {
	t.Helper()
	store := readmodel.NewStore()
	store.ApplySnapshot(scope, snapshot)
	publisher := NewPublisher(PublisherOptions{
		ScopeID: scope, Root: root, ConfigFile: filepath.Join(root, "crux.config.ts"),
		Store: store, Lines: mapping.NewLineIndex(),
	})
	t.Cleanup(publisher.Close)
	return publisher
}

func navigationTestDefinition(id, file string, line int, start, end *int) api.ProjectDefinition {
	endLine := line
	return api.ProjectDefinition{
		ID: id, Kind: "prompt", Name: "writer",
		Source: &api.SourceLoc{File: file, Line: line, Column: start},
		SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{
			File: file, StartLine: line, EndLine: &endLine, StartColumn: start, EndColumn: end,
		}},
	}
}

func navigationTestFile(t *testing.T, root, name, content string) string {
	t.Helper()
	file := filepath.Join(root, name)
	if err := os.WriteFile(file, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return file
}
