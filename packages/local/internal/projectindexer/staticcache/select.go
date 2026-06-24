package staticcache

import (
	"slices"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func writablePrimaryMisses(plan staticprotocol.Plan) []string {
	primary := sourceFileSet(plan.PrimaryFiles)
	if len(primary) == 0 {
		primary = sourceFileSet(plan.Files)
	}
	misses := sourceFileSet(plan.CacheMisses)
	out := make([]string, 0, len(misses))
	for file := range misses {
		if primary[file] {
			out = append(out, file)
		}
	}
	slices.Sort(out)
	return out
}

func sourceFileSet(files []staticprotocol.SourceFile) map[string]bool {
	set := map[string]bool{}
	for _, file := range files {
		if file.File != "" {
			set[file.File] = true
		}
	}
	return set
}

func sourceFileMap(files []staticprotocol.SourceFile) map[string]staticprotocol.SourceFile {
	out := make(map[string]staticprotocol.SourceFile, len(files))
	for _, file := range files {
		if file.File != "" {
			out[file.File] = file
		}
	}
	return out
}

func patchSourceMap(sources []store.IndexSourceFile) map[string]store.IndexSourceFile {
	out := make(map[string]store.IndexSourceFile, len(sources))
	for _, source := range sources {
		if source.File != "" {
			out[source.File] = source
		}
	}
	return out
}

func semanticProfileMap(profile *projectindex.SemanticSourceProfile) map[string]*projectindex.SemanticSourceProfileFile {
	out := map[string]*projectindex.SemanticSourceProfileFile{}
	if profile == nil {
		return out
	}
	for index := range profile.Files {
		file := &profile.Files[index]
		if file.File != "" {
			out[file.File] = file
		}
	}
	return out
}

func definitionsForCache(
	file string,
	definitionIDs map[string]bool,
	definitions []store.ProjectDefinition,
) []store.ProjectDefinition {
	out := []store.ProjectDefinition{}
	for _, definition := range definitions {
		if definitionIDs[definition.ID] || (definition.Source != nil && definition.Source.File == file) {
			out = append(out, definition)
		}
	}
	return out
}

func relationsForCache(
	file string,
	definitionIDs map[string]bool,
	relations []store.ProjectRelation,
) []store.ProjectRelation {
	out := []store.ProjectRelation{}
	for _, relation := range relations {
		if definitionIDs[relation.From] || (relation.Source != nil && relation.Source.File == file) {
			out = append(out, relation)
		}
	}
	return out
}

func diagnosticsForCache(
	file string,
	definitionIDs map[string]bool,
	diagnosticIDs []string,
	diagnostics []store.IndexDiagnostic,
) []store.IndexDiagnostic {
	diagnosticIDSet := definitionIDSet(diagnosticIDs)
	out := []store.IndexDiagnostic{}
	for _, diagnostic := range diagnostics {
		if diagnosticIDSet[diagnostic.ID] || (diagnostic.Source != nil && diagnostic.Source.File == file) {
			out = append(out, diagnostic)
			continue
		}
		if anyStringInSet(diagnostic.RelatedDefinitionIDs, definitionIDs) {
			out = append(out, diagnostic)
		}
	}
	return out
}

func definitionIDSet(ids []string) map[string]bool {
	set := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id != "" {
			set[id] = true
		}
	}
	return set
}

func definitionIDs(definitions []store.ProjectDefinition) map[string]bool {
	set := make(map[string]bool, len(definitions))
	for _, definition := range definitions {
		if definition.ID != "" {
			set[definition.ID] = true
		}
	}
	return set
}

func anyStringInSet(values []string, set map[string]bool) bool {
	for _, value := range values {
		if set[value] {
			return true
		}
	}
	return false
}
