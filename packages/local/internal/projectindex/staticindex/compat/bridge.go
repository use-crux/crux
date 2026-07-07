package compat

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/requestwire"
)

type ArtifactReader interface {
	ReadArtifact(context.Context, requestwire.Request, projectindex.ProjectIndexArtifactKind) (json.RawMessage, error)
}

type ArtifactReaderFunc func(context.Context, requestwire.Request, projectindex.ProjectIndexArtifactKind) (json.RawMessage, error)

func (f ArtifactReaderFunc) ReadArtifact(ctx context.Context, request requestwire.Request, artifact projectindex.ProjectIndexArtifactKind) (json.RawMessage, error) {
	return f(ctx, request, artifact)
}

func LoadManifest(
	ctx context.Context,
	reader ArtifactReader,
	root string,
	configPath string,
) (projectindex.StaticExtensionHostManifestResult, error) {
	req := requestwire.Request{
		Method:                        "loadStaticExtensionHostManifest",
		Root:                          root,
		ConfigPath:                    configPath,
		NativeCompilerProtocolVersion: protocol.Version,
	}
	resp, err := reader.ReadArtifact(ctx, req, projectindex.ProjectIndexArtifactStaticExtensionHostManifest)
	if err != nil {
		return projectindex.StaticExtensionHostManifestResult{}, err
	}
	return DecodeManifest(resp, root)
}

func ExtractEvidenceFacts(
	ctx context.Context,
	reader ArtifactReader,
	root string,
	configPath string,
	projectName string,
	jobs []json.RawMessage,
) ([]json.RawMessage, error) {
	if len(jobs) == 0 {
		return nil, nil
	}
	req := requestwire.Request{
		Method:         "extractStaticEvidenceBatch",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		ResolutionMode: "config-policy",
		Jobs:           jobs,
	}
	resp, err := reader.ReadArtifact(ctx, req, projectindex.ProjectIndexArtifactStaticExtensionEvidenceBatch)
	if err != nil {
		return nil, err
	}
	return DecodeEvidenceFacts(resp, root)
}

func CheckRuleFacts(
	ctx context.Context,
	reader ArtifactReader,
	root string,
	configPath string,
	projectName string,
	patch projectindex.IndexPatch,
	files []string,
) ([]json.RawMessage, error) {
	graph, err := json.Marshal(map[string]any{
		"definitions": patch.Facts.Definitions,
		"relations":   patch.Facts.Relations,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal static rule graph: %w", err)
	}
	req := requestwire.Request{
		Method:         "checkStaticRules",
		Root:           root,
		ConfigPath:     configPath,
		ProjectName:    projectName,
		ResolutionMode: "config-policy",
		Graph:          graph,
		Files:          append([]string(nil), files...),
	}
	resp, err := reader.ReadArtifact(ctx, req, projectindex.ProjectIndexArtifactStaticRuleCheck)
	if err != nil {
		return nil, err
	}
	return DecodeRuleFacts(resp, root)
}
