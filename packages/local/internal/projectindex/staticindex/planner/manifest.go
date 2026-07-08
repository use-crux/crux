package planner

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

const syntaxFrontendVersion = "oxc_parser@0.139.0+crux_native_group3.7"

var defaultCallNames = []string{
	"Agent",
	"agent",
	"blackboard",
	"cascade",
	"consensus",
	"constraint",
	"context",
	"convexAgent",
	"compressToBudget",
	"convexRecordStore",
	"convexStorage",
	"convexVectorStore",
	"convexWorkspaceBlobStore",
	"createTool",
	"cruxFlow",
	"durableTask",
	"evaluate",
	"expandParents",
	"fallback",
	"fanout",
	"flow",
	"fromRegistry",
	"guardrail",
	"inMemoryBlobStore",
	"inMemoryRecordStore",
	"inMemoryStorage",
	"inMemoryVectorStore",
	"injectable",
	"llmJudge",
	"memory",
	"parallel",
	"pipeline",
	"prompt",
	"registry",
	"knowledgeBase",
	"rerank",
	"reranker",
	"retrievalRecipe",
	"retrievalStep",
	"retrieve",
	"retriever",
	"rewriteQuery",
	"retry",
	"router",
	"scope",
	"split",
	"storage",
	"swarm",
	"task",
	"tool",
	"upstashRedisRecordStore",
	"upstashVectorStore",
	"workspace",
}

var defaultCallInterestNames = []string{
	"agent",
	"blackboard",
	"cascade",
	"consensus",
	"constraint",
	"context",
	"convexAgent",
	"compressToBudget",
	"convexRecordStore",
	"convexStorage",
	"convexVectorStore",
	"convexWorkspaceBlobStore",
	"createTool",
	"cruxFlow",
	"durableTask",
	"evaluate",
	"expandParents",
	"fallback",
	"fanout",
	"flow",
	"fromRegistry",
	"guardrail",
	"inMemoryBlobStore",
	"inMemoryRecordStore",
	"inMemoryStorage",
	"inMemoryVectorStore",
	"injectable",
	"llmJudge",
	"memory",
	"parallel",
	"pipeline",
	"prompt",
	"registry",
	"knowledgeBase",
	"rerank",
	"reranker",
	"retrievalRecipe",
	"retrievalStep",
	"retrieve",
	"retriever",
	"rewriteQuery",
	"retry",
	"router",
	"scope",
	"split",
	"storage",
	"swarm",
	"task",
	"tool",
	"upstashRedisRecordStore",
	"upstashVectorStore",
	"workspace",
}

func syntaxFrontend() projectindex.SyntaxFrontend {
	return projectindex.SyntaxFrontend{Name: "oxc-rust", Version: syntaxFrontendVersion}
}

func defaultCallInterests() []projectindex.StaticCallInterest {
	out := make([]projectindex.StaticCallInterest, 0, len(defaultCallInterestNames))
	for _, name := range defaultCallInterestNames {
		interest := projectindex.StaticCallInterest{Name: name, Source: "extractor-pattern"}
		if name == "durableTask" {
			interest.ImportFrom = []string{"@use-crux/core", "@use-crux/core/runtime"}
		}
		if name == "evaluate" {
			arg := 1
			interest.ConfigArg = &arg
		}
		out = append(out, interest)
	}
	return out
}

func defaultConstructorInterests() []projectindex.StaticConstructorInterest {
	return []projectindex.StaticConstructorInterest{{Name: "Agent", Source: "extractor-pattern"}}
}

func defaultStaticInterests() json.RawMessage {
	payload := map[string]any{
		"calls":         defaultCallInterests(),
		"constructors":  defaultConstructorInterests(),
		"compatibility": map[string]string{"mode": "declared"},
	}
	data, _ := json.Marshal(payload)
	return data
}

func defaultHost() json.RawMessage {
	families := []string{
		"agent",
		"blackboard",
		"composition",
		"context",
		"eval",
		"flow",
		"injectable",
		"memory",
		"prompt",
		"rag.retriever",
		"registry-skill",
		"routing",
		"runtime.task",
		"safety",
		"scorer",
		"skill-registry",
		"storage",
		"tool",
		"workspace",
	}
	extractors := make([]map[string]any, 0, len(families))
	for _, family := range families {
		extractors = append(extractors, map[string]any{
			"extension": map[string]string{
				"name":    "@use-crux/indexer/crux-core",
				"version": "2",
			},
			"name": family,
			"mode": "native-covered",
			"native": map[string]any{
				"covered": true,
				"family":  family,
			},
		})
	}
	payload := map[string]any{
		"extractors":                          extractors,
		"bundledNativeExtractorCount":         len(extractors),
		"extensionTypeScriptExtractorCount":   0,
		"typeScriptRuleCount":                 0,
		"requiresTypeScriptHostForExtensions": false,
		"requiresTypeScriptHostForRules":      false,
		"requiresCompatibilityEvidence":       false,
		"nativeOnlyEligible":                  true,
	}
	data, _ := json.Marshal(payload)
	return data
}
