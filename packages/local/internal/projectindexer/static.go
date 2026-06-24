package projectindexer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

type projectNativeStaticSkeletonResult struct {
	Prepare  projectNativeStaticPrepareResponse
	Analyze  projectNativeStaticAnalyzeResponse
	Finalize projectNativeStaticFinalizeResponse
}

// runNativeStaticCompilerSkeleton exercises the planned Go-owned native static
// compiler lane without wiring it into production `nativeAst` indexing.
//
// The method deliberately requires StaticCompiler rather than the
// syntax-record parser interfaces. Tests use that split to prove the skeleton
// does not route through Node projection or StaticSyntaxFileRecord streaming.
func (w *Worker) runNativeStaticCompilerSkeleton(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	files []projectNativeStaticSourceFile,
) (projectNativeStaticSkeletonResult, error) {
	if w == nil || w.syntaxParser == nil {
		return projectNativeStaticSkeletonResult{}, fmt.Errorf("project native static compiler is not configured")
	}
	compiler, ok := w.syntaxParser.(StaticCompiler)
	if !ok {
		return projectNativeStaticSkeletonResult{}, fmt.Errorf("project syntax parser does not implement native static compiler")
	}

	identity := projectNativeStaticSkeletonIdentity()
	prepare, err := compiler.NativeStaticPrepare(ctx, projectNativeStaticPrepareRequest{
		ProtocolVersion: projectNativeStaticProtocolVersion,
		Method:          projectNativeStaticPrepareMethod,
		Root:            root,
		ConfigPath:      configPath,
		ProjectName:     projectName,
		Identity:        identity,
		Files:           files,
	})
	if err != nil {
		return projectNativeStaticSkeletonResult{}, fmt.Errorf("native static prepare: %w", err)
	}

	analyze, err := compiler.NativeStaticAnalyzeStream(ctx, projectNativeStaticAnalyzeRequest{
		ProtocolVersion: projectNativeStaticProtocolVersion,
		Method:          projectNativeStaticAnalyzeMethod,
		Stream:          true,
		Identity:        identity,
		Plan:            prepare.Plan,
		Files:           projectNativeStaticAnalyzeFiles(prepare.Plan.CacheMisses),
	}, nil)
	if err != nil {
		return projectNativeStaticSkeletonResult{}, fmt.Errorf("native static analyze: %w", err)
	}

	finalize, err := compiler.NativeStaticFinalize(ctx, projectNativeStaticFinalizeRequest{
		ProtocolVersion: projectNativeStaticProtocolVersion,
		Method:          projectNativeStaticFinalizeMethod,
		Identity:        identity,
		NativeFacts:     analyze.Facts,
		ExtensionFacts:  []json.RawMessage{},
	})
	if err != nil {
		return projectNativeStaticSkeletonResult{}, fmt.Errorf("native static finalize: %w", err)
	}

	return projectNativeStaticSkeletonResult{
		Prepare:  prepare,
		Analyze:  analyze,
		Finalize: finalize,
	}, nil
}

func (w *Worker) indexProjectAstPatchFromNativeStaticCompiler(
	ctx context.Context,
	root string,
	configPath string,
	projectName string,
	plan devtools.ProjectStaticSyntaxPlan,
	compiler StaticCompiler,
) (devtools.IndexPatch, ProjectIndexAstTiming, bool, error) {
	started := time.Now()
	sourceInput, err := projectNativeStaticSourceInputFromPlan(plan)
	if err != nil {
		return devtools.IndexPatch{}, ProjectIndexAstTiming{}, false, err
	}

	identity := projectNativeStaticSkeletonIdentity()
	prepare, err := compiler.NativeStaticPrepare(ctx, projectNativeStaticPrepareRequest{
		ProtocolVersion:          projectNativeStaticProtocolVersion,
		Method:                   projectNativeStaticPrepareMethod,
		Root:                     root,
		ConfigPath:               configPath,
		ProjectName:              projectName,
		Identity:                 identity,
		Files:                    sourceInput.Files,
		PrimaryFiles:             sourceInput.PrimaryFiles,
		CallNames:                append([]string(nil), plan.CallNames...),
		CallInterests:            projectSyntaxCallInterests(plan.CallInterests),
		ConstructorNames:         append([]string(nil), plan.ConstructorNames...),
		ConstructorInterests:     projectSyntaxConstructorInterests(plan.ConstructorInterests),
		PruneNativeFactCallNames: append([]string(nil), plan.PruneNativeFactCallNames...),
		CacheInputs:              append([]json.RawMessage(nil), plan.CacheInputs...),
		ExtensionHost:            plan.StaticHost,
	})
	if err != nil {
		return devtools.IndexPatch{}, ProjectIndexAstTiming{}, false, fmt.Errorf("native static prepare: %w", err)
	}

	analyzeSourceFiles := projectNativeStaticSourceFilesToAnalyze(prepare.Plan.CacheMisses, projectSyntaxPlanFilesToParse(plan))
	analyzeFiles, err := projectNativeStaticAnalyzeFilesWithSourceText(analyzeSourceFiles, sourceInput.SourceTextByFile)
	if err != nil {
		return devtools.IndexPatch{}, ProjectIndexAstTiming{}, false, err
	}
	analyzeRequest := projectNativeStaticAnalyzeRequest{
		ProtocolVersion:            projectNativeStaticProtocolVersion,
		Method:                     projectNativeStaticAnalyzeMethod,
		Identity:                   identity,
		Plan:                       prepare.Plan,
		Files:                      analyzeFiles,
		ExtensionEvidenceInterests: plan.StaticInterests,
	}
	if compileStreamer, ok := compiler.(projectNativeStaticCompileStreamer); ok && projectStaticPlanNativeOnlyEligible(plan) {
		return w.indexProjectAstPatchFromNativeStaticCompileStream(
			ctx,
			root,
			plan,
			compileStreamer,
			identity,
			started,
			prepare.Plan,
			analyzeFiles,
			sourceInput,
		)
	}
	analyze, evidenceFacts, evidenceNodeStarted, err := w.projectNativeStaticAnalyzeWithExtensionFacts(
		ctx,
		root,
		configPath,
		projectName,
		compiler,
		analyzeRequest,
	)
	timing := ProjectIndexAstTiming{NativeParseAndForwardMs: elapsedMs(started)}
	if err != nil {
		if evidenceNodeStarted {
			return devtools.IndexPatch{}, projectIndexAstTimingNodeRequired(timing, projectIndexNodeReasonNativeStaticEvidence), false, nil
		}
		return devtools.IndexPatch{}, ProjectIndexAstTiming{}, false, fmt.Errorf("native static analyze: %w", err)
	}
	extensionFacts, err := projectNativeStaticFinalizeExtensionFacts(plan)
	if err != nil {
		return devtools.IndexPatch{}, ProjectIndexAstTiming{}, false, err
	}
	if evidenceNodeStarted {
		timing = projectIndexAstTimingNodeRequired(timing, projectIndexNodeReasonNativeStaticEvidence)
	}
	extensionFacts = append(extensionFacts, evidenceFacts...)
	replayedFacts, err := projectNativeStaticReplayCacheFacts(root, projectName, prepare.Plan.CacheHits)
	if err != nil {
		return devtools.IndexPatch{}, ProjectIndexAstTiming{}, false, err
	}
	nativeFacts := append(replayedFacts, analyze.Facts...)
	emitBuiltinLints := false
	finalizeRequest := projectNativeStaticFinalizeRequest{
		ProtocolVersion:  projectNativeStaticProtocolVersion,
		Method:           projectNativeStaticFinalizeMethod,
		Identity:         identity,
		NativeFacts:      nativeFacts,
		ExtensionFacts:   extensionFacts,
		RelationSpecs:    plan.RelationSpecs,
		LintConfig:       plan.LintConfig,
		LintFiles:        append([]string(nil), plan.Files...),
		EmitBuiltinLints: nativeStaticBoolPtr(emitBuiltinLints),
	}
	patch, timings, usedNativeStatic, _, err := projectNativeStaticPatchFromFinalizeStream(ctx, root, compiler, finalizeRequest)
	if err != nil {
		return devtools.IndexPatch{}, ProjectIndexAstTiming{}, false, fmt.Errorf("native static finalize: %w", err)
	}
	if !usedNativeStatic {
		if len(timings) == 0 {
			return devtools.IndexPatch{}, projectIndexAstTimingNodeRequired(timing, projectIndexNodeReasonNativeStaticEmpty), false, nil
		}
		return devtools.IndexPatch{}, projectIndexAstTimingNodeRequired(timing, projectIndexNodeReasonNativeStaticIncomplete), false, nil
	}
	if sourceInput.SemanticSourceProfile != nil {
		patch.SemanticSourceProfile = projectNativeStaticSemanticRequestProfile(sourceInput.SemanticSourceProfile, plan.Files)
	}
	if nativeStaticCacheStatusEnabled() {
		projectNativeStaticWriteCacheFromPatch(root, plan.CacheInputs, sourceInput, prepare.Plan, patch)
	}
	timing.NodeTimings = timings
	return patch, timing, true, nil
}

func projectNativeStaticFinalizeExtensionFacts(plan devtools.ProjectStaticSyntaxPlan) ([]json.RawMessage, error) {
	facts := []json.RawMessage{}
	if fact, ok, err := projectNativeStaticGroupedFact("sourceGraph", plan.SourceGraph); err != nil {
		return nil, err
	} else if ok {
		facts = append(facts, fact)
	}
	if fact, ok, err := projectNativeStaticGroupedFact("ruleDescriptors", plan.RuleDescriptors); err != nil {
		return nil, err
	} else if ok {
		facts = append(facts, fact)
	}
	return facts, nil
}

func projectNativeStaticGroupedFact(key string, value json.RawMessage) (json.RawMessage, bool, error) {
	value = bytes.TrimSpace(value)
	if len(value) == 0 || bytes.Equal(value, []byte("null")) {
		return nil, false, nil
	}
	data, err := json.Marshal(map[string]json.RawMessage{key: value})
	if err != nil {
		return nil, false, fmt.Errorf("native static grouped %s facts: %w", key, err)
	}
	return data, true, nil
}

func nativeStaticBoolPtr(value bool) *bool {
	return &value
}

func projectNativeStaticSkeletonIdentity() projectNativeStaticRunIdentity {
	return projectNativeStaticRunIdentity{
		ProtocolVersion: projectNativeStaticProtocolVersion,
		Compiler: projectNativeStaticVersionIdentity{
			Name:    "crux-native-static-skeleton",
			Version: "phase-3",
		},
		Oxc: projectNativeStaticVersionIdentity{
			Name:    "oxc-rust",
			Version: "phase-3",
		},
		PrimitiveManifest: projectNativeStaticDigestIdentity{
			Name:    "crux-first-party-primitives",
			Version: "phase-3",
		},
		RelationPolicy: projectNativeStaticDigestIdentity{
			Name:    "crux-relation-policy",
			Version: "phase-3",
		},
		ExtensionManifests: []projectNativeStaticDigestIdentity{},
		FirstPartyGraphRules: projectNativeStaticDigestIdentity{
			Name:    "crux-first-party-graph-rules",
			Version: "phase-3",
		},
		CompilerProjection: projectNativeStaticDigestIdentity{
			Name:    "crux-static-projection",
			Version: "phase-3",
		},
	}
}
