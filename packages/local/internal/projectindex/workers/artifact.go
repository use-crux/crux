package workers

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/requestwire"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// ResolveProjectModel returns the JSON-safe source-discovery Project Model for
// root. Config policy may be imported, but authored source modules are not
// executed; richer runtime evidence is supplied by staged indexing.
func (w *Bundle) ResolveProjectModel(ctx context.Context, root, configPath, projectName string) (json.RawMessage, error) {
	req := requestwire.Request{
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
	req := requestwire.Request{
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

// GenerateRuntimeArtifacts runs the TypeScript runtime artifact generator from
// native Project Index definitions. Source discovery is owned by Go/Rust.
func (w *Bundle) GenerateRuntimeArtifacts(ctx context.Context, root string, definitions []store.ProjectDefinition) (json.RawMessage, error) {
	req := requestwire.Request{
		Method:      "generateRuntimeArtifacts",
		Root:        root,
		Definitions: definitions,
	}
	return w.streamArtifact(ctx, req, projectindex.ProjectIndexArtifactRuntimeArtifacts)
}

// CreateDeploymentManifest projects one completed Project Index snapshot in
// the TypeScript worker, which owns privacy filtering and canonical hashing.
func (w *Bundle) CreateDeploymentManifest(ctx context.Context, input projectindex.DeploymentManifestProjectionInput) (json.RawMessage, error) {
	req := requestwire.Request{
		Method:                  "createDeploymentManifest",
		Root:                    input.Root,
		ProjectID:               input.ProjectID,
		Definitions:             input.Definitions,
		Relations:               input.Relations,
		StaticFrontend:          input.StaticFrontend,
		ManifestSemanticBackend: input.SemanticBackend,
		SemanticStatus:          input.SemanticStatus,
	}
	return w.streamArtifact(ctx, req, projectindex.ProjectIndexArtifactDeploymentManifest)
}

// RunRuntimeOperation executes a Runtime Engine operation in the TypeScript worker.
func (w *Bundle) RunRuntimeOperation(ctx context.Context, root, operation, workID string, includeDetails bool) (json.RawMessage, error) {
	req := requestwire.Request{
		Method:                "runRuntimeOperation",
		Root:                  root,
		RuntimeOperation:      operation,
		RuntimeWorkID:         workID,
		RuntimeIncludeDetails: includeDetails,
	}
	return w.streamArtifact(ctx, req, projectindex.ProjectIndexArtifactRuntimeOperation)
}

// RunSetupOperation executes aggregate project setup in the TypeScript worker.
func (w *Bundle) RunSetupOperation(ctx context.Context, root, mode string) (json.RawMessage, error) {
	req := requestwire.Request{
		Method:    "runSetupOperation",
		Root:      root,
		SetupMode: mode,
	}
	return w.streamArtifact(ctx, req, projectindex.ProjectIndexArtifactSetupOperation)
}
