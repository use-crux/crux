package server

import (
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

// auditedNavigationSnapshot mirrors the navigation-bearing values emitted by
// the real navigation-project fixture index.
func auditedNavigationSnapshot(root string) readmodel.Snapshot {
	agentFile := filepath.Join(root, "src", "agent.ts")
	primitivesFile := filepath.Join(root, "src", "primitives.ts")
	schemaFile := filepath.Join(root, "src", "schema.ts")
	agentColumn, promptColumn, toolColumn := 28, 29, 28
	endColumn, relationColumn, refColumn := 3, 34, 28
	agentEndLine, promptEndLine, toolEndLine := 9, 9, 16

	definitions := []api.ProjectDefinition{
		{
			ID: "agent:src-agent.ts:writerAgent", Kind: "agent", Name: "writerAgent",
			Source: &api.SourceLoc{File: agentFile, Line: 5, Column: &agentColumn},
			SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{
				File: agentFile, StartLine: 5, EndLine: &agentEndLine,
				StartColumn: &agentColumn, EndColumn: &endColumn,
			}},
		},
		{
			ID: "prompt:lsp-navigation-writer", Kind: "prompt", Name: "lsp-navigation-writer",
			Source: &api.SourceLoc{File: primitivesFile, Line: 5, Column: &promptColumn},
			SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{
				File: primitivesFile, StartLine: 5, EndLine: &promptEndLine,
				StartColumn: &promptColumn, EndColumn: &endColumn,
			}},
			SourceRefs: []api.ProjectSourceRef{{
				ID:   "prompt:lsp-navigation-writer:source:schema:input:writerInput",
				Role: "schema", Property: "input", Symbol: "writerInput",
				Source: api.SourceLoc{File: schemaFile, Line: 4, Column: &refColumn},
			}},
		},
		{
			ID: "tool:lsp-navigation-outline", Kind: "tool", Name: "lsp-navigation-outline",
			Source: &api.SourceLoc{File: primitivesFile, Line: 12, Column: &toolColumn},
			SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{
				File: primitivesFile, StartLine: 12, EndLine: &toolEndLine,
				StartColumn: &toolColumn, EndColumn: &endColumn,
			}},
		},
	}
	relations := []api.ProjectRelation{
		{
			ID:   "relation:agent.uses_prompt:agent:src-agent.ts:writerAgent:prompt:writer-prompt",
			Type: "agent.uses_prompt", From: "agent:src-agent.ts:writerAgent", To: "prompt:writer-prompt",
			Fidelity: "partial", Source: &api.SourceLoc{File: agentFile, Line: 5, Column: &agentColumn},
		},
		{
			ID:   "relation:agent.uses_prompt:agent:LSP-Navigation-Writer:prompt:lsp-navigation-writer",
			Type: "agent.uses_prompt", From: "agent:LSP-Navigation-Writer", To: "prompt:lsp-navigation-writer",
			Fidelity: "resolved", Source: &api.SourceLoc{File: agentFile, Line: 5, Column: &relationColumn},
		},
		{
			ID:   "relation:agent.uses_tool:agent:LSP-Navigation-Writer:tool:lsp-navigation-outline",
			Type: "agent.uses_tool", From: "agent:LSP-Navigation-Writer", To: "tool:lsp-navigation-outline",
			Fidelity: "resolved", Source: &api.SourceLoc{File: agentFile, Line: 5, Column: &relationColumn},
		},
	}
	return readmodel.Snapshot{Definitions: definitions, Relations: relations}
}
