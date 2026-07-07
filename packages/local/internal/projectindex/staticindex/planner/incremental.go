package planner

import (
	"encoding/json"
	"sort"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

// IncrementalPlanInput carries the bounded source scope for a watch-triggered
// Static Index run. The caller owns graph safety checks; this builder only
// constructs the compiler plan without walking the whole project.
type IncrementalPlanInput struct {
	Root              string
	ProjectName       string
	ConfigFile        string
	RuntimeConfigured *bool
	Files             []string
	PrimaryFiles      []string
	SourceGraph       json.RawMessage
	LintConfig        json.RawMessage
}

// BuildIncremental constructs a Static Index plan for a graph-proven
// incremental refresh. It intentionally leaves CacheInputs empty so the watch
// hot path parses the bounded source set without cache-status IO.
func BuildIncremental(input IncrementalPlanInput) projectindex.ProjectStaticSyntaxPlan {
	files := uniqueSortedFiles(input.Files)
	primaryFiles := uniqueSortedFiles(input.PrimaryFiles)
	if len(primaryFiles) == 0 {
		primaryFiles = append([]string(nil), files...)
	}
	return projectindex.ProjectStaticSyntaxPlan{
		Root:                     input.Root,
		ProjectName:              input.ProjectName,
		ConfigFile:               input.ConfigFile,
		RuntimeConfigured:        input.RuntimeConfigured,
		Files:                    files,
		PrimaryFiles:             primaryFiles,
		FilesToParse:             files,
		CacheMisses:              primaryFiles,
		CallNames:                append([]string(nil), defaultCallNames...),
		CallInterests:            defaultCallInterests(),
		ConstructorNames:         []string{"Agent"},
		ConstructorInterests:     defaultConstructorInterests(),
		PruneNativeFactCallNames: []string{"cascade", "fallback", "router"},
		SyntaxFrontend:           syntaxFrontend(),
		StaticSyntaxEnabled:      true,
		StaticInterests:          defaultStaticInterests(),
		LintConfig:               append(json.RawMessage(nil), input.LintConfig...),
		SourceGraph:              append(json.RawMessage(nil), input.SourceGraph...),
		StaticHost:               defaultHost(),
	}
}

func uniqueSortedFiles(files []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(files))
	for _, file := range files {
		if file == "" || seen[file] {
			continue
		}
		seen[file] = true
		out = append(out, file)
	}
	sort.Strings(out)
	return out
}
