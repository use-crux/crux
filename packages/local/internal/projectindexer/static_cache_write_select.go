package projectindexer

import (
	"slices"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func projectNativeStaticWritablePrimaryMisses(plan projectNativeStaticPlan) []string {
	primary := projectNativeStaticSourceFileSet(plan.PrimaryFiles)
	if len(primary) == 0 {
		primary = projectNativeStaticSourceFileSet(plan.Files)
	}
	misses := projectNativeStaticSourceFileSet(plan.CacheMisses)
	out := make([]string, 0, len(misses))
	for file := range misses {
		if primary[file] {
			out = append(out, file)
		}
	}
	slices.Sort(out)
	return out
}

func projectNativeStaticSourceFileSet(files []projectNativeStaticSourceFile) map[string]bool {
	set := map[string]bool{}
	for _, file := range files {
		if file.File != "" {
			set[file.File] = true
		}
	}
	return set
}

func projectNativeStaticSourceFileMap(files []projectNativeStaticSourceFile) map[string]projectNativeStaticSourceFile {
	out := make(map[string]projectNativeStaticSourceFile, len(files))
	for _, file := range files {
		if file.File != "" {
			out[file.File] = file
		}
	}
	return out
}

func projectNativeStaticPatchSourceMap(sources []store.IndexSourceFile) map[string]store.IndexSourceFile {
	out := make(map[string]store.IndexSourceFile, len(sources))
	for _, source := range sources {
		if source.File != "" {
			out[source.File] = source
		}
	}
	return out
}

func projectNativeStaticSemanticProfileMap(profile *devtools.SemanticSourceProfile) map[string]*devtools.SemanticSourceProfileFile {
	out := map[string]*devtools.SemanticSourceProfileFile{}
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

func projectNativeStaticDefinitionsForCache(
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

func projectNativeStaticRelationsForCache(
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

func projectNativeStaticDiagnosticsForCache(
	file string,
	definitionIDs map[string]bool,
	diagnosticIDs []string,
	diagnostics []store.IndexDiagnostic,
) []store.IndexDiagnostic {
	diagnosticIDSet := projectNativeStaticDefinitionIDSet(diagnosticIDs)
	out := []store.IndexDiagnostic{}
	for _, diagnostic := range diagnostics {
		if diagnosticIDSet[diagnostic.ID] || (diagnostic.Source != nil && diagnostic.Source.File == file) {
			out = append(out, diagnostic)
			continue
		}
		if projectNativeStaticAnyStringInSet(diagnostic.RelatedDefinitionIDs, definitionIDs) {
			out = append(out, diagnostic)
		}
	}
	return out
}

func projectNativeStaticDefinitionIDSet(ids []string) map[string]bool {
	set := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id != "" {
			set[id] = true
		}
	}
	return set
}

func projectNativeStaticDefinitionIDs(definitions []store.ProjectDefinition) map[string]bool {
	set := make(map[string]bool, len(definitions))
	for _, definition := range definitions {
		if definition.ID != "" {
			set[definition.ID] = true
		}
	}
	return set
}

func projectNativeStaticAnyStringInSet(values []string, set map[string]bool) bool {
	for _, value := range values {
		if set[value] {
			return true
		}
	}
	return false
}
