package devtools

import (
	"context"
	"os"
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/manifestcontract"
	"github.com/use-crux/crux/packages/local/internal/projectindex/readmodel"
)

const maxCatalogStatusManifestBytes = 128 * 1024 * 1024

type catalogManifestCounter interface {
	Count(context.Context) (int, error)
	SoleIdentity(context.Context) (manifestcontract.DeploymentManifest, bool, error)
}

// WithManifestStore enables immutable manifest counts on Catalog status.
func (s *Service) WithManifestStore(store catalogManifestCounter) *Service {
	s.manifestStore = store
	return s
}

// CatalogList returns every current definition in canonical Catalog order.
func (s *Service) CatalogList(_ context.Context, kind string) (api.CatalogListV1, error) {
	index, err := s.catalogIndex()
	if err != nil {
		return api.CatalogListV1{}, err
	}
	return readmodel.CatalogList(index, kind), nil
}

// CatalogDefinition returns one safe current-Catalog detail projection.
func (s *Service) CatalogDefinition(ctx context.Context, definitionID string) (api.CatalogDefinitionV1, bool, error) {
	index, err := s.catalogIndex()
	if err != nil {
		return api.CatalogDefinitionV1{}, false, err
	}
	evidence, err := s.catalogEvidence(ctx, index, definitionID)
	if err != nil {
		return api.CatalogDefinitionV1{}, false, err
	}
	activity, err := s.catalogRuntimeActivity(ctx, definitionID)
	if err != nil {
		return api.CatalogDefinitionV1{}, false, err
	}
	definition, found := readmodel.CatalogShow(index, definitionID, activity, evidence)
	return definition, found, nil
}

// CatalogExplanation returns the stable current-Catalog explanation. Historical
// manifest selectors are intentionally not exposed by the v1 CLI.
func (s *Service) CatalogExplanation(ctx context.Context, definitionID string) (api.CatalogExplanationV1, bool, error) {
	index, err := s.catalogIndex()
	if err != nil {
		return api.CatalogExplanationV1{}, false, err
	}
	evidence, err := s.catalogEvidence(ctx, index, definitionID)
	if err != nil {
		return api.CatalogExplanationV1{}, false, err
	}
	explanation, found := readmodel.CatalogExplain(index, definitionID, evidence, nil)
	watch := s.indexService.WatchStatus()
	if watch.LastRun != nil && watch.LastRun.FallbackUsed {
		explanation.Indexing.Fallback = watch.LastRun.FallbackReason
	}
	return explanation, found, nil
}

// CatalogStatus returns compiler, watch, and manifest-store state without
// manufacturing unavailable backend or current-manifest identity.
func (s *Service) CatalogStatus(ctx context.Context) (api.CatalogStatusV1, error) {
	index, err := s.catalogIndex()
	if err != nil {
		return api.CatalogStatusV1{}, err
	}
	watch, err := s.ProjectIndexWatchStatus(ctx)
	if err != nil {
		return api.CatalogStatusV1{}, err
	}
	var manifestCount *int
	if s.manifestStore != nil {
		count, err := s.manifestStore.Count(ctx)
		if err != nil {
			return api.CatalogStatusV1{}, err
		}
		manifestCount = &count
	}
	current, err := s.catalogCurrentManifest(ctx, index)
	if err != nil {
		return api.CatalogStatusV1{}, err
	}
	status := readmodel.CatalogStatus(index, watch, manifestCount, current)
	if mode := s.indexService.SemanticMode(); mode != "" {
		if status.Semantic == nil {
			status.Semantic = &api.CatalogSemanticStatusV1{}
		}
		status.Semantic.Mode = string(mode)
	}
	return status, nil
}

func (s *Service) catalogCurrentManifest(ctx context.Context, index api.IndexData) (*api.CatalogManifestIdentityV1, error) {
	root := ""
	if index.Project != nil {
		root = index.Project.Root
	}
	if identity := generatedCatalogManifestIdentity(root); identity != nil {
		return identity, nil
	}
	if s.manifestStore == nil {
		return nil, nil
	}
	manifest, found, err := s.manifestStore.SoleIdentity(ctx)
	if err != nil || !found {
		return nil, err
	}
	return &api.CatalogManifestIdentityV1{ProjectID: manifest.ProjectID, ManifestID: manifest.ManifestID}, nil
}

func generatedCatalogManifestIdentity(root string) *api.CatalogManifestIdentityV1 {
	if root == "" {
		return nil
	}
	path := filepath.Join(root, ".crux", "project-index.manifest.json")
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxCatalogStatusManifestBytes {
		return nil
	}
	artifact, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	manifest, err := projectindex.ParseDeploymentManifest(artifact)
	if err == nil {
		err = projectindex.VerifyDeploymentManifest(manifest)
	}
	if err != nil {
		return nil
	}
	return &api.CatalogManifestIdentityV1{ProjectID: manifest.ProjectID, ManifestID: manifest.ManifestID}
}

func (s *Service) catalogIndex() (api.IndexData, error) {
	var index api.IndexData
	return index, assignJSON(&index, s.indexReadModel())
}

func (s *Service) catalogEvidence(ctx context.Context, index api.IndexData, definitionID string) ([]api.CatalogEvidenceV1, error) {
	root := ""
	if index.Project != nil {
		root = index.Project.Root
	}
	facts, err := s.indexService.DefinitionEvidence(ctx, root, definitionID)
	if err != nil {
		return nil, err
	}
	return readmodel.CatalogEvidence(root, facts), nil
}

func (s *Service) catalogRuntimeActivity(ctx context.Context, definitionID string) (*api.CatalogRuntimeActivityV1, error) {
	if s.observability == nil {
		return nil, nil
	}
	summary, err := s.observability.DefinitionActivitySummary(ctx, definitionID)
	if err != nil {
		return nil, err
	}
	activity := &api.CatalogRuntimeActivityV1{DefinitionID: definitionID, RunCount: summary.RunCount}
	if summary.LastRun != nil {
		activity.LastRunID = summary.LastRun.RunID
		activity.LastRunAt = summary.LastRun.StartedAt
		activity.LastStatus = summary.LastRun.Status
	}
	return activity, nil
}
