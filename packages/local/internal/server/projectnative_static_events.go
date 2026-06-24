package server

import (
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

func projectNativeStaticPatchFromFinalizeEvents(
	root string,
	events []json.RawMessage,
) (devtools.IndexPatch, []devtools.ProjectIndexPhaseTiming, bool, error) {
	patch, timings, complete, err := projectNativeStaticPatchFromFinalizeEventsUnchecked(root, events)
	if err != nil {
		return devtools.IndexPatch{}, nil, true, err
	}
	if !complete {
		return devtools.IndexPatch{}, timings, false, nil
	}
	return patch, timings, true, nil
}

func projectNativeStaticPatchFromFinalizeEventsUnchecked(
	root string,
	events []json.RawMessage,
) (devtools.IndexPatch, []devtools.ProjectIndexPhaseTiming, bool, error) {
	if len(events) == 0 {
		return devtools.IndexPatch{}, nil, false, nil
	}

	collector := devtools.NewProjectIndexPatchStreamCollector(devtools.ProjectIndexPatchStreamOptions{
		Root:             root,
		Budget:           devtools.IndexPatchBudget{},
		MaxBytes:         projectIndexWorkerMaxResponseBytes,
		MaxFactsPerBatch: projectIndexWorkerMaxFactsPerBatch("indexProjectAst"),
		Producer:         projectIndexWorkerProducer,
	})
	for _, event := range events {
		if err := collector.Handle(event); err != nil {
			return devtools.IndexPatch{}, nil, false, fmt.Errorf("native static finalize event stream: %w", err)
		}
	}
	result, err := collector.IncrementalResult()
	if err != nil {
		return devtools.IndexPatch{}, nil, false, fmt.Errorf("native static finalize event stream: %w", err)
	}
	patches := result.Patches
	if len(patches) != 1 {
		return devtools.IndexPatch{}, nil, false, fmt.Errorf("native static finalize returned %d patches, want 1", len(patches))
	}
	return patches[0], collector.Timings(), projectNativeStaticFinalizeComplete(result.Decision), nil
}

func projectNativeStaticFinalizeComplete(decision map[string]any) bool {
	complete, ok := decision["nativeStaticComplete"].(bool)
	return ok && complete
}
