package planner

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

const syntaxFrontendVersion = "oxc_parser@0.139.0+crux_native_group3.12"

var defaultCallNames = []string{
	"Agent",
	"agent",
	"assertions",
	"blackboard",
	"cascade",
	"consensus",
	"constraint",
	"context",
	"convexAgent",
	"compressToBudget",
	"convexRecordStore",
	"convexStorage",
	"convexSearchStore",
	"convexAssetStore",
	"createTool",
	"cruxFlow",
	"durableTask",
	"describe",
	"embed",
	"embedMany",
	"embedding",
	"effect",
	"rollbackOnError",
	"evaluate",
	"record",
	"expandParents",
	"fallback",
	"fanout",
	"fileSource",
	"filesSource",
	"flow",
	"fromRegistry",
	"generate",
	"generateImage",
	"generateSpeech",
	"guardrail",
	"inMemoryAssetStore",
	"inMemoryRecordStore",
	"inMemoryStorage",
	"inMemorySearchStore",
	"injectable",
	"index",
	"indexChunks",
	"indexDocuments",
	"indexer",
	"knowledgeModel",
	"llmJudge",
	"memory",
	"mediaClassifier",
	"communities",
	"parallel",
	"pipeline",
	"prompt",
	"registry",
	"reindex",
	"relate",
	"relateEntities",
	"relateReferences",
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
	"stream",
	"streamImage",
	"streamSpeech",
	"swarm",
	"task",
	"textSource",
	"thread",
	"tool",
	"transcribe",
	"upstashRedisRecordStore",
	"upstashSearchStore",
	"urlSource",
	"urlsSource",
	"view",
	"workspace",
}

var defaultCallInterestNames = []string{
	"agent",
	"assertions",
	"blackboard",
	"cascade",
	"consensus",
	"constraint",
	"context",
	"convexAgent",
	"compressToBudget",
	"convexRecordStore",
	"convexStorage",
	"convexSearchStore",
	"convexAssetStore",
	"createTool",
	"cruxFlow",
	"durableTask",
	"describe",
	"embed",
	"embedMany",
	"embedding",
	"effect",
	"rollbackOnError",
	"evaluate",
	"record",
	"expandParents",
	"fallback",
	"fanout",
	"fileSource",
	"filesSource",
	"flow",
	"fromRegistry",
	"generate",
	"generateImage",
	"generateSpeech",
	"guardrail",
	"inMemoryAssetStore",
	"inMemoryRecordStore",
	"inMemoryStorage",
	"inMemorySearchStore",
	"injectable",
	"index",
	"indexChunks",
	"indexDocuments",
	"indexer",
	"knowledgeModel",
	"llmJudge",
	"memory",
	"mediaClassifier",
	"communities",
	"parallel",
	"pipeline",
	"prompt",
	"registry",
	"reindex",
	"relate",
	"relateEntities",
	"relateReferences",
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
	"stream",
	"streamImage",
	"streamSpeech",
	"swarm",
	"task",
	"textSource",
	"thread",
	"tool",
	"transcribe",
	"upstashRedisRecordStore",
	"upstashSearchStore",
	"urlSource",
	"urlsSource",
	"view",
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
		if name == "effect" {
			arg := 2
			interest.ImportFrom = []string{"@use-crux/core", "@use-crux/core/effect"}
			interest.ConfigArg = &arg
			interest.Properties = []string{"version", "recover", "resource"}
		}
		if name == "rollbackOnError" {
			arg := 1
			interest.ImportFrom = []string{"@use-crux/core", "@use-crux/core/effect"}
			interest.ConfigArg = &arg
			interest.Properties = []string{"recovery"}
		}
		if name == "thread" {
			interest.ImportFrom = []string{"@use-crux/core/thread"}
		}
		if name == "assertions" || name == "communities" || name == "knowledgeModel" || name == "relate" || name == "relateEntities" || name == "relateReferences" {
			interest.ImportFrom = []string{"@use-crux/core/knowledge"}
		}
		if name == "knowledgeBase" {
			interest.ImportFrom = []string{"@use-crux/core/knowledge", "@use-crux/core/retrieval", "@use-crux/core"}
		}
		if name == "evaluate" || name == "fileSource" || name == "filesSource" || name == "urlSource" || name == "urlsSource" || name == "textSource" {
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
		"embedding",
		"embedding.call",
		"effect",
		"evidence.record",
		"eval",
		"flow",
		"injectable",
		"knowledge",
		"memory",
		"prompt",
		"rag.indexer",
		"rag.retriever",
		"registry-skill",
		"routing",
		"runtime.task",
		"safety",
		"scorer",
		"skill-registry",
		"storage",
		"thread",
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
	for _, family := range []string{"media.operation", "ingest.source"} {
		extractors = append(extractors, map[string]any{
			"extension": map[string]string{
				"name":    "@use-crux/indexer/crux-core-media",
				"version": "4",
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
