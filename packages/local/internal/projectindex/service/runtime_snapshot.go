package service

import (
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func (s *Service) registeredBaseLocked() store.IndexData {
	return s.projectRegisteredSnapshotLocked(s.indexState.Index())
}

func (s *Service) projectRegisteredSnapshotLocked(compilerBase store.IndexData) store.IndexData {
	if s.runtimeSnapshot == nil {
		return compilerBase
	}
	return projectindex.ProjectRegisteredRuntimeSnapshot(compilerBase, *s.runtimeSnapshot)
}

// retireRegisteredMCPServers prevents a startup snapshot from resurrecting an
// owner that a later authoritative compiler pass proved was removed.
func (s *Service) retireRegisteredMCPServers(compilerBase store.IndexData) {
	if s.runtimeSnapshot == nil {
		return
	}
	present := definitionIDsByKind(compilerBase.Definitions, "mcp.server")
	retired := map[string]bool{}
	for _, definition := range s.runtimeSnapshot.Definitions {
		if definition.Kind == "mcp.server" && !present[definition.ID] {
			retired[definition.ID] = true
		}
	}
	if len(retired) == 0 {
		return
	}

	ownedTools := map[string]bool{}
	for _, relation := range s.runtimeSnapshot.Relations {
		if relation.Type == "mcp.server.provides_tool" && retired[relation.From] {
			ownedTools[relation.To] = true
		}
	}
	removedToolNames := map[string]bool{}
	definitions := s.runtimeSnapshot.Definitions[:0]
	for _, definition := range s.runtimeSnapshot.Definitions {
		if retired[definition.ID] || ownedTools[definition.ID] {
			if ownedTools[definition.ID] {
				removedToolNames[definition.Name] = true
			}
			continue
		}
		definitions = append(definitions, definition)
	}
	relations := s.runtimeSnapshot.Relations[:0]
	for _, relation := range s.runtimeSnapshot.Relations {
		if retired[relation.From] || retired[relation.To] ||
			ownedTools[relation.From] || ownedTools[relation.To] {
			continue
		}
		relations = append(relations, relation)
	}
	tools := s.runtimeSnapshot.Tools[:0]
	for _, tool := range s.runtimeSnapshot.Tools {
		if !removedToolNames[tool.Name] {
			tools = append(tools, tool)
		}
	}
	s.runtimeSnapshot.Definitions = definitions
	s.runtimeSnapshot.Relations = relations
	s.runtimeSnapshot.Tools = tools
}

func definitionIDsByKind(definitions []store.ProjectDefinition, kind string) map[string]bool {
	ids := map[string]bool{}
	for _, definition := range definitions {
		if definition.Kind == kind {
			ids[definition.ID] = true
		}
	}
	return ids
}
