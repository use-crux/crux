package host

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/host/indexwire"
)

// ResolveProjectModel returns the JSON-safe source-discovery Project Model for
// root. Config policy may be imported, but authored source modules are not
// executed; richer runtime evidence is supplied by staged indexing.
func (w *Bundle) ResolveProjectModel(ctx context.Context, root, configPath, projectName string) (json.RawMessage, error) {
	req := indexwire.Request{
		Method:         "resolveProjectModel",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		ResolutionMode: "config-policy",
	}
	return w.streamArtifact(ctx, req, projectindex.ProjectIndexArtifactProjectModel)
}

// InspectProjectConfig returns the JSON-safe effective Crux configuration for
// root, including resolved values and origin tags for each config() domain.
func (w *Bundle) InspectProjectConfig(ctx context.Context, root, configPath, projectName string) (json.RawMessage, error) {
	req := indexwire.Request{
		Method:         "inspectProjectConfig",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		ResolutionMode: "config-policy",
	}
	resp, err := w.streamArtifact(ctx, req, projectindex.ProjectIndexArtifactProjectConfig)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return nil, err
		}
		resp, err = w.sourceOnlyArtifactFallback(ctx, req, projectindex.ProjectIndexArtifactProjectConfig, err)
		if err != nil {
			return nil, err
		}
	}
	return resp, nil
}
