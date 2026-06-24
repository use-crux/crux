package staticplan

import (
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

const projectNativeStaticSyntaxFrontendVersion = "oxc_parser@0.133.0+crux_native_group3.5"

var projectNativeStaticDefaultCallNames = []string{
	"Agent",
	"agent",
	"blackboard",
	"cascade",
	"consensus",
	"constraint",
	"context",
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
	"memory",
	"parallel",
	"pipeline",
	"prompt",
	"registry",
	"retrievalPipeline",
	"retriever",
	"router",
	"swarm",
	"tool",
	"workspace",
}

var projectNativeStaticDefaultCallInterestNames = []string{
	"agent",
	"blackboard",
	"cascade",
	"consensus",
	"constraint",
	"context",
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
	"memory",
	"parallel",
	"pipeline",
	"prompt",
	"registry",
	"retrievalPipeline",
	"retriever",
	"router",
	"swarm",
	"tool",
	"workspace",
}

func projectNativeStaticSyntaxFrontend() devtools.SyntaxFrontend {
	return devtools.SyntaxFrontend{Name: "oxc-rust", Version: projectNativeStaticSyntaxFrontendVersion}
}

func projectNativeStaticDefaultCallInterests() []devtools.StaticCallInterest {
	out := make([]devtools.StaticCallInterest, 0, len(projectNativeStaticDefaultCallInterestNames))
	for _, name := range projectNativeStaticDefaultCallInterestNames {
		interest := devtools.StaticCallInterest{Name: name, Source: "extractor-pattern"}
		if name == "evaluate" {
			arg := 1
			interest.ConfigArg = &arg
		}
		out = append(out, interest)
	}
	return out
}

func projectNativeStaticDefaultConstructorInterests() []devtools.StaticConstructorInterest {
	return []devtools.StaticConstructorInterest{{Name: "Agent", Source: "extractor-pattern"}}
}

func projectNativeStaticDefaultStaticInterests() json.RawMessage {
	payload := map[string]any{
		"calls":         projectNativeStaticDefaultCallInterests(),
		"constructors":  projectNativeStaticDefaultConstructorInterests(),
		"compatibility": map[string]string{"mode": "declared"},
	}
	data, _ := json.Marshal(payload)
	return data
}

func projectNativeStaticDefaultHost() json.RawMessage {
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
		"safety",
		"scorer",
		"skill-registry",
		"tool",
		"workspace",
	}
	extractors := make([]map[string]any, 0, len(families))
	for _, family := range families {
		extractors = append(extractors, map[string]any{
			"extension": map[string]string{
				"name":    "@crux/indexer/crux-core",
				"version": "1",
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
		"bundledTypeScriptExtractorCount":     0,
		"extensionTypeScriptExtractorCount":   0,
		"typeScriptRuleCount":                 0,
		"requiresTypeScriptHostForBundled":    false,
		"requiresTypeScriptHostForExtensions": false,
		"requiresTypeScriptHostForRules":      false,
		"requiresCompatibilityEvidence":       false,
		"nativeOnlyEligible":                  true,
	}
	data, _ := json.Marshal(payload)
	return data
}
