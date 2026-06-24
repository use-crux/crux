package projectindexer

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/nodeworker"
)

type projectNativeStaticCompileStreamer interface {
	NativeStaticCompileStream(context.Context, projectNativeStaticCompileRequest, projectNativeStaticFinalizeStreamHandler) (projectNativeStaticFinalizeResponse, error)
}

func (w *SyntaxWorker) NativeStaticCompileStream(
	ctx context.Context,
	request projectNativeStaticCompileRequest,
	handle projectNativeStaticFinalizeStreamHandler,
) (projectNativeStaticFinalizeResponse, error) {
	if w == nil || w.worker == nil {
		return projectNativeStaticFinalizeResponse{}, fmt.Errorf("project native static compiler is not configured")
	}
	id := w.nextID.Add(1)
	request.ID = id
	request.Stream = true

	var response projectNativeStaticFinalizeResponse
	done := false
	err := nodeworker.StreamCall(ctx, w.worker, request, func(raw json.RawMessage) (bool, error) {
		event, err := decodeProjectNativeStaticFinalizeStreamEvent(raw)
		if err != nil {
			return false, err
		}
		if event.ID != id {
			return false, fmt.Errorf("native static compile stream response id %d, want %d", event.ID, id)
		}
		if !event.OK {
			return false, nativeStaticFinalizeStreamError(event.Error)
		}
		switch event.Type {
		case "event":
			if len(event.Event) == 0 {
				return false, fmt.Errorf("native static compile stream event missing project index event")
			}
			if handle != nil {
				if err := handle(event); err != nil {
					return false, err
				}
			}
		case "done":
			if event.Response == nil {
				return false, fmt.Errorf("native static compile stream done event missing response")
			}
			stage := *event.Response
			if err := validateProjectNativeStaticResponse(stage.ProtocolVersion, stage.Method, projectNativeStaticCompileMethod); err != nil {
				return false, err
			}
			response = stage
			response.Events = nil
			done = true
		default:
			return false, fmt.Errorf("native static compile stream returned unknown event type %q", event.Type)
		}
		return done, nil
	})
	if err != nil {
		return projectNativeStaticFinalizeResponse{}, err
	}
	if !done {
		return projectNativeStaticFinalizeResponse{}, fmt.Errorf("native static compile stream ended before done event")
	}
	return response, nil
}

func (p *SyntaxWorkerPool) NativeStaticCompileStream(
	ctx context.Context,
	request projectNativeStaticCompileRequest,
	handle projectNativeStaticFinalizeStreamHandler,
) (projectNativeStaticFinalizeResponse, error) {
	worker, err := p.nativeStaticCompilerWorker()
	if err != nil {
		return projectNativeStaticFinalizeResponse{}, err
	}
	return worker.NativeStaticCompileStream(ctx, request, handle)
}

func projectNativeStaticPatchFromCompileStream(
	ctx context.Context,
	root string,
	compiler projectNativeStaticCompileStreamer,
	request projectNativeStaticCompileRequest,
) (devtools.IndexPatch, []devtools.ProjectIndexPhaseTiming, bool, projectNativeStaticFinalizeResponse, error) {
	request.Stream = true
	collector := devtools.NewProjectIndexPatchStreamCollector(devtools.ProjectIndexPatchStreamOptions{
		Root:             root,
		Budget:           devtools.IndexPatchBudget{},
		MaxBytes:         workerMaxResponseBytes,
		MaxFactsPerBatch: maxFactsPerBatch("indexProjectAst"),
		Producer:         workerProducer,
	})
	eventCount := 0
	response, err := compiler.NativeStaticCompileStream(ctx, request, func(event projectNativeStaticFinalizeStreamEvent) error {
		eventCount++
		return collector.Handle(event.Event)
	})
	if err != nil {
		return devtools.IndexPatch{}, nil, false, response, err
	}
	if eventCount == 0 {
		return devtools.IndexPatch{}, nil, false, response, nil
	}
	result, err := collector.IncrementalResult()
	if err != nil {
		return devtools.IndexPatch{}, nil, false, response, fmt.Errorf("native static compile event stream: %w", err)
	}
	patches := result.Patches
	if len(patches) != 1 {
		return devtools.IndexPatch{}, nil, false, response, fmt.Errorf("native static compile returned %d patches, want 1", len(patches))
	}
	return patches[0], collector.Timings(), projectNativeStaticFinalizeComplete(result.Decision), response, nil
}

func (w *Worker) indexProjectAstPatchFromNativeStaticCompileStream(
	ctx context.Context,
	root string,
	plan devtools.ProjectStaticSyntaxPlan,
	compiler projectNativeStaticCompileStreamer,
	identity projectNativeStaticRunIdentity,
	started time.Time,
	preparePlan projectNativeStaticPlan,
	analyzeFiles []projectNativeStaticAnalyzeFile,
	sourceInput projectNativeStaticSourceInput,
) (devtools.IndexPatch, ProjectIndexAstTiming, bool, error) {
	extensionFacts, err := projectNativeStaticFinalizeExtensionFacts(plan)
	if err != nil {
		return devtools.IndexPatch{}, ProjectIndexAstTiming{}, false, err
	}
	replayedFacts, err := projectNativeStaticReplayCacheFacts(root, plan.ProjectName, preparePlan.CacheHits)
	if err != nil {
		return devtools.IndexPatch{}, ProjectIndexAstTiming{}, false, err
	}
	emitBuiltinLints := false
	patch, timings, usedNativeStatic, _, err := projectNativeStaticPatchFromCompileStream(ctx, root, compiler, projectNativeStaticCompileRequest{
		ProtocolVersion:  projectNativeStaticProtocolVersion,
		Method:           projectNativeStaticCompileMethod,
		Identity:         identity,
		Plan:             preparePlan,
		Files:            analyzeFiles,
		NativeFacts:      replayedFacts,
		ExtensionFacts:   extensionFacts,
		RelationSpecs:    plan.RelationSpecs,
		LintConfig:       plan.LintConfig,
		LintFiles:        append([]string(nil), plan.Files...),
		EmitBuiltinLints: nativeStaticBoolPtr(emitBuiltinLints),
	})
	timing := ProjectIndexAstTiming{NativeParseAndForwardMs: elapsedMs(started)}
	if err != nil {
		return devtools.IndexPatch{}, ProjectIndexAstTiming{}, false, fmt.Errorf("native static compile: %w", err)
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
		projectNativeStaticWriteCacheFromPatch(root, plan.CacheInputs, sourceInput, preparePlan, patch)
	}
	timing.NodeTimings = timings
	return patch, timing, true, nil
}
