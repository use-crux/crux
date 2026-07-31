package planner

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

const syntaxFrontendVersion = "oxc_parser@0.139.0+crux_native_group3.9"

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
	"convexAssetStore",
	"createTool",
	"cruxFlow",
	"durableTask",
	"describe",
	"embed",
	"embedMany",
	"embedding",
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
	"inMemoryVectorStore",
	"injectable",
	"index",
	"indexChunks",
	"indexDocuments",
	"indexer",
	"llmJudge",
	"memory",
	"mediaClassifier",
	"parallel",
	"pipeline",
	"prompt",
	"registry",
	"reindex",
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
	"upstashVectorStore",
	"urlSource",
	"urlsSource",
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
	"convexAssetStore",
	"createTool",
	"cruxFlow",
	"durableTask",
	"describe",
	"embed",
	"embedMany",
	"embedding",
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
	"inMemoryVectorStore",
	"injectable",
	"index",
	"indexChunks",
	"indexDocuments",
	"indexer",
	"llmJudge",
	"memory",
	"mediaClassifier",
	"parallel",
	"pipeline",
	"prompt",
	"registry",
	"reindex",
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
	"upstashVectorStore",
	"urlSource",
	"urlsSource",
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
		if name == "thread" {
			interest.ImportFrom = []string{"@use-crux/core/thread"}
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
		"evidence.record",
		"eval",
		"flow",
		"injectable",
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
