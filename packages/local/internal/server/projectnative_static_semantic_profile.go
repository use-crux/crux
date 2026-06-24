package server

import (
	"bytes"
	"regexp"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

var projectNativeStaticSemanticCallNames = []string{
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
	"retrievalPipeline",
	"retriever",
	"router",
	"swarm",
	"tool",
	"context",
	"prompt",
	"when",
	"workspace",
}

var projectNativeStaticNativeDirectCallNames = []string{
	"agent",
	"cascade",
	"fallback",
	"router",
	"tool",
	"context",
	"prompt",
}

var (
	projectNativeStaticCruxCallPattern      = regexp.MustCompile(`\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(`)
	projectNativeStaticCoreImportPattern    = regexp.MustCompile(`from\s+['"]@crux/core['"]`)
	projectNativeStaticSemanticCallNameSet  = projectNativeStaticStringSet(projectNativeStaticSemanticCallNames)
	projectNativeStaticNativeDirectCallName = projectNativeStaticStringSet(projectNativeStaticNativeDirectCallNames)
)

func projectNativeStaticSemanticSourceProfile(reads []projectNativeStaticSourceRead) *devtools.SemanticSourceProfile {
	if len(reads) == 0 {
		return nil
	}
	files := make([]devtools.SemanticSourceProfileFile, 0, len(reads))
	for _, read := range reads {
		if profile, ok := projectNativeStaticSemanticSourceProfileFileFromRead(read); ok {
			files = append(files, profile)
		}
	}
	return projectNativeStaticSemanticSourceProfileFromFiles(files)
}

func projectNativeStaticSemanticSourceProfileFileFromRead(
	read projectNativeStaticSourceRead,
) (devtools.SemanticSourceProfileFile, bool) {
	if read.err != nil || read.file == "" {
		return devtools.SemanticSourceProfileFile{}, false
	}
	return devtools.SemanticSourceProfileFile{
		File:        read.file,
		SourceHash:  read.sourceHash,
		SourceBytes: len(read.source),
		Hints:       projectNativeStaticSemanticSourceProfileHints(read.source),
	}, true
}

func projectNativeStaticSemanticSourceProfileFromFiles(
	files []devtools.SemanticSourceProfileFile,
) *devtools.SemanticSourceProfile {
	if len(files) == 0 {
		return nil
	}
	sourceBytes := 0
	for _, file := range files {
		sourceBytes += file.SourceBytes
	}
	return &devtools.SemanticSourceProfile{
		Files:       files,
		SourceBytes: sourceBytes,
		Complete:    true,
	}
}

func projectNativeStaticSemanticSourceProfileHints(source []byte) *devtools.SemanticSourceProfileHints {
	callNames := projectNativeStaticCruxCallNames(source)
	return &devtools.SemanticSourceProfileHints{
		CruxCallNames:             callNames,
		HasZodObject:              bytes.Contains(source, []byte("z.object")),
		NativeDirectCruxCandidate: projectNativeStaticIsNativeDirectCandidateSource(source, callNames),
	}
}

func projectNativeStaticCruxCallNames(source []byte) []string {
	matches := projectNativeStaticCruxCallPattern.FindAllSubmatch(source, -1)
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
		if !projectNativeStaticSemanticCallNameSet[name] || seen[name] {
			continue
		}
		seen[name] = true
		callNames = append(callNames, name)
	}
	sort.Strings(callNames)
	return callNames
}

func projectNativeStaticIsNativeDirectCandidateSource(source []byte, callNames []string) bool {
	return projectNativeStaticCoreImportPattern.Match(source) && projectNativeStaticIsNativeDirectCandidateCallSet(callNames)
}

func projectNativeStaticIsNativeDirectCandidateCallSet(callNames []string) bool {
	hasNativeDirectCall := false
	for _, callName := range callNames {
		if projectNativeStaticNativeDirectCallName[callName] {
			hasNativeDirectCall = true
			continue
		}
		if projectNativeStaticSemanticCallNameSet[callName] {
			return false
		}
	}
	return hasNativeDirectCall
}

func projectNativeStaticStringSet(values []string) map[string]bool {
	set := make(map[string]bool, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			set[value] = true
		}
	}
	return set
}
