package staticpatch

import (
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

type Options struct {
	Root             string
	MaxBytes         int
	MaxFactsPerBatch int
	Producer         string
}

func NewCollector(options Options) *projectindex.ProjectIndexPatchStreamCollector {
	return projectindex.NewProjectIndexPatchStreamCollector(projectindex.ProjectIndexPatchStreamOptions{
		Root:             options.Root,
		Budget:           projectindex.IndexPatchBudget{},
		MaxBytes:         options.MaxBytes,
		MaxFactsPerBatch: options.MaxFactsPerBatch,
		Producer:         options.Producer,
	})
}

func FromEvents(
	options Options,
	events []json.RawMessage,
) (projectindex.IndexPatch, []projectindex.ProjectIndexPhaseTiming, bool, error) {
	patch, timings, complete, err := FromEventsUnchecked(options, events)
	if err != nil {
		return projectindex.IndexPatch{}, nil, true, err
	}
	if !complete {
		return projectindex.IndexPatch{}, timings, false, nil
	}
	return patch, timings, true, nil
}

func FromEventsUnchecked(
	options Options,
	events []json.RawMessage,
) (projectindex.IndexPatch, []projectindex.ProjectIndexPhaseTiming, bool, error) {
	if len(events) == 0 {
		return projectindex.IndexPatch{}, nil, false, nil
	}

	collector := NewCollector(options)
	for _, event := range events {
		if err := collector.Handle(event); err != nil {
			return projectindex.IndexPatch{}, nil, false, fmt.Errorf("native static finalize event stream: %w", err)
		}
	}
	return Result(collector, "native static finalize")
}

func Result(
	collector *projectindex.ProjectIndexPatchStreamCollector,
	label string,
) (projectindex.IndexPatch, []projectindex.ProjectIndexPhaseTiming, bool, error) {
	result, err := collector.IncrementalResult()
	if err != nil {
		return projectindex.IndexPatch{}, nil, false, fmt.Errorf("%s event stream: %w", label, err)
	}
	patches := result.Patches
	if len(patches) != 1 {
		return projectindex.IndexPatch{}, nil, false, fmt.Errorf("%s returned %d patches, want 1", label, len(patches))
	}
	return patches[0], collector.Timings(), Complete(result.Decision), nil
}

func Complete(decision map[string]any) bool {
	complete, ok := decision["nativeStaticComplete"].(bool)
	return ok && complete
}
