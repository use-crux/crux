package observability

import (
	"context"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex/manifestcontract"
)

// ManifestResolutionState is the explicit historical join outcome for a run.
type ManifestResolutionState string

const (
	ManifestResolved             ManifestResolutionState = "resolved"
	ManifestDefinitionUnresolved ManifestResolutionState = "definition-unresolved"
	ManifestUnresolved           ManifestResolutionState = "manifest-unresolved"
	ManifestUnspecified          ManifestResolutionState = "manifest-unspecified"
	ManifestProjectMismatch      ManifestResolutionState = "project-mismatch"
)

// HistoricalDefinitionResolution joins one runtime ref to its exact manifest.
type HistoricalDefinitionResolution struct {
	Ref        DefinitionRef                        `json:"ref"`
	Resolution ManifestResolutionState              `json:"resolution"`
	Definition *manifestcontract.ManifestDefinition `json:"definition,omitempty"`
}

// RunManifestResolution describes one run's exact historical catalog join.
type RunManifestResolution struct {
	ProjectID   string                           `json:"projectId,omitempty"`
	ManifestID  string                           `json:"manifestId,omitempty"`
	Resolution  ManifestResolutionState          `json:"resolution"`
	Definitions []HistoricalDefinitionResolution `json:"definitions"`
}

type deploymentManifestReader interface {
	Get(context.Context, string, string) (manifestcontract.DeploymentManifest, bool, error)
}

// WithManifestStore enables exact historical resolution for run detail reads.
func (s *Service) WithManifestStore(store deploymentManifestReader) *Service {
	if s != nil {
		s.manifestStore = store
	}
	return s
}

// ResolveRunManifest resolves one persisted run against only its named tuple.
func (s *Service) ResolveRunManifest(ctx context.Context, runID, requestedProjectID string) (RunManifestResolution, error) {
	run, err := s.Run(ctx, runID)
	if err != nil {
		return RunManifestResolution{}, err
	}
	refs, err := s.runDefinitionRefs(ctx, run.RunID)
	if err != nil {
		return RunManifestResolution{}, fmt.Errorf("list definition refs for run %q: %w", runID, err)
	}
	return s.resolveRunManifest(ctx, run, refs, requestedProjectID)
}

func (s *Service) resolveRunManifest(ctx context.Context, run RunSummary, refs []DefinitionRef, requestedProjectID string) (RunManifestResolution, error) {
	resolution := RunManifestResolution{
		Resolution:  ManifestUnspecified,
		Definitions: []HistoricalDefinitionResolution{},
	}
	if run.Deployment == nil {
		return resolution, nil
	}
	resolution.ProjectID = run.Deployment.ProjectID
	resolution.ManifestID = run.Deployment.ManifestID
	if run.Deployment.ManifestID == "" {
		return resolution, nil
	}
	if requestedProjectID != "" && requestedProjectID != run.Deployment.ProjectID {
		resolution.Resolution = ManifestProjectMismatch
		return resolution, nil
	}
	if s.manifestStore == nil {
		resolution.Resolution = ManifestUnresolved
		return resolution, nil
	}
	manifest, found, err := s.manifestStore.Get(ctx, run.Deployment.ProjectID, run.Deployment.ManifestID)
	if err != nil {
		return RunManifestResolution{}, fmt.Errorf("load deployment manifest for run %q: %w", run.RunID, err)
	}
	if !found {
		resolution.Resolution = ManifestUnresolved
		return resolution, nil
	}
	definitions := make(map[string]manifestcontract.ManifestDefinition, len(manifest.Content.Definitions))
	for _, definition := range manifest.Content.Definitions {
		definitions[definition.ID] = definition
	}
	resolution.Resolution = ManifestResolved
	for _, ref := range refs {
		definition, found := definitions[ref.ID]
		item := HistoricalDefinitionResolution{Ref: ref, Resolution: ManifestDefinitionUnresolved}
		if found {
			item.Resolution = ManifestResolved
			item.Definition = &definition
		} else {
			resolution.Resolution = ManifestDefinitionUnresolved
		}
		resolution.Definitions = append(resolution.Definitions, item)
	}
	return resolution, nil
}
