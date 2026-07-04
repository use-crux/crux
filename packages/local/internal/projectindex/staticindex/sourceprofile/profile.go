package sourceprofile

import (
	"bytes"
	"regexp"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

var semanticCallNames = []string{
	"Agent",
	"agent",
	"blackboard",
	"cascade",
	"consensus",
	"constraint",
	"convexAgent",
	"createTool",
	"cruxFlow",
	"evaluate",
	"fallback",
	"flow",
	"fromRegistry",
	"guardrail",
	"injectable",
	"llmJudge",
	"match",
	"memory",
	"parallel",
	"pipeline",
	"registry",
	"compressToBudget",
	"expandParents",
	"fanout",
	"knowledgeBase",
	"rerank",
	"reranker",
	"retrievalRecipe",
	"retrievalStep",
	"retrieve",
	"retriever",
	"rewriteQuery",
	"router",
	"swarm",
	"tool",
	"context",
	"prompt",
	"when",
	"workspace",
}

var nativeDirectCallNames = []string{
	"agent",
	"cascade",
	"fallback",
	"router",
	"tool",
	"context",
	"prompt",
}

var (
	cruxCallPattern      = regexp.MustCompile(`\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(`)
	coreImportPattern    = regexp.MustCompile(`from\s+['"]@use-crux/core['"]`)
	semanticCallNameSet  = stringSet(semanticCallNames)
	nativeDirectCallName = stringSet(nativeDirectCallNames)
)

func profileFromReads(reads []sourceRead) *projectindex.SemanticSourceProfile {
	if len(reads) == 0 {
		return nil
	}
	files := make([]projectindex.SemanticSourceProfileFile, 0, len(reads))
	for _, read := range reads {
		if profile, ok := profileFileFromRead(read); ok {
			files = append(files, profile)
		}
	}
	return ProfileFromFiles(files)
}

func profileFileFromRead(
	read sourceRead,
) (projectindex.SemanticSourceProfileFile, bool) {
	if read.err != nil || read.file == "" {
		return projectindex.SemanticSourceProfileFile{}, false
	}
	return projectindex.SemanticSourceProfileFile{
		File:        read.file,
		SourceHash:  read.sourceHash,
		SourceBytes: len(read.source),
		Hints:       profileHints(read.source),
	}, true
}

func ProfileFromFiles(
	files []projectindex.SemanticSourceProfileFile,
) *projectindex.SemanticSourceProfile {
	if len(files) == 0 {
		return nil
	}
	sourceBytes := 0
	for _, file := range files {
		sourceBytes += file.SourceBytes
	}
	return &projectindex.SemanticSourceProfile{
		Files:       files,
		SourceBytes: sourceBytes,
		Complete:    true,
	}
}

func profileHints(source []byte) *projectindex.SemanticSourceProfileHints {
	callNames := CruxCallNames(source)
	return &projectindex.SemanticSourceProfileHints{
		CruxCallNames:             callNames,
		HasZodObject:              bytes.Contains(source, []byte("z.object")),
		NativeDirectCruxCandidate: isNativeDirectCandidateSource(source, callNames),
	}
}

func CruxCallNames(source []byte) []string {
	matches := cruxCallPattern.FindAllSubmatch(source, -1)
	if len(matches) == 0 {
		return []string{}
	}
	seen := map[string]bool{}
	callNames := []string{}
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		name := string(match[1])
		if !semanticCallNameSet[name] || seen[name] {
			continue
		}
		seen[name] = true
		callNames = append(callNames, name)
	}
	sort.Strings(callNames)
	return callNames
}

func isNativeDirectCandidateSource(source []byte, callNames []string) bool {
	return coreImportPattern.Match(source) && isNativeDirectCandidateCallSet(callNames)
}

func isNativeDirectCandidateCallSet(callNames []string) bool {
	hasNativeDirectCall := false
	for _, callName := range callNames {
		if nativeDirectCallName[callName] {
			hasNativeDirectCall = true
			continue
		}
		if semanticCallNameSet[callName] {
			return false
		}
	}
	return hasNativeDirectCall
}

func stringSet(values []string) map[string]bool {
	set := make(map[string]bool, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			set[value] = true
		}
	}
	return set
}
