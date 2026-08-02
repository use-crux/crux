package planner

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/compat"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/requestwire"
)

const (
	ReasonConfig     = "static-index-config"
	ReasonExtensions = "static-index-extensions"
)

type ArtifactReader interface {
	ReadArtifact(context.Context, requestwire.Request, projectindex.ProjectIndexArtifactKind) (json.RawMessage, error)
}

type ArtifactReaderFunc func(context.Context, requestwire.Request, projectindex.ProjectIndexArtifactKind) (json.RawMessage, error)

func (f ArtifactReaderFunc) ReadArtifact(ctx context.Context, request requestwire.Request, artifact projectindex.ProjectIndexArtifactKind) (json.RawMessage, error) {
	return f(ctx, request, artifact)
}

type InspectResult struct {
	Plan        projectindex.ProjectStaticSyntaxPlan
	Timings     []projectindex.ProjectIndexPhaseTiming
	NodeStarted bool
	NodeReasons []string
}

func Inspect(
	ctx context.Context,
	reader ArtifactReader,
	root string,
	configPath string,
	projectName string,
) (InspectResult, error) {
	config := projectindex.ProjectStaticIndexConfig{Root: root}
	timings := []projectindex.ProjectIndexPhaseTiming{}
	nodeReasons := []string{}
	if ConfigMayRequireNode(root, configPath) {
		configStarted := time.Now()
		loaded, err := LoadConfig(ctx, reader, root, configPath)
		if err != nil {
			return InspectResult{}, err
		}
		config = loaded
		if config.CacheDisabled {
			ctx = projectindex.WithoutCache(ctx)
		}
		nodeReasons = append(nodeReasons, ReasonConfig)
		timings = AppendTiming(timings, TimingConfig, configStarted, 1)
	}

	var extensionManifest *projectindex.StaticExtensionHostManifestResult
	if len(config.Extensions) > 0 {
		manifestStarted := time.Now()
		manifest, err := compat.LoadManifest(ctx, compat.ArtifactReaderFunc(reader.ReadArtifact), root, configPath)
		if err != nil {
			return InspectResult{}, err
		}
		extensionManifest = &manifest
		timings = AppendTiming(timings, TimingExtensionManifest, manifestStarted, 1)
		nodeReasons = append(nodeReasons, ReasonExtensions)
	}

	planResult, err := BuildWithExtensionManifestContext(ctx, root, projectName, config, extensionManifest)
	if err != nil {
		return InspectResult{}, err
	}
	timings = append(timings, planResult.Timings...)
	return InspectResult{
		Plan:        planResult.Plan,
		Timings:     timings,
		NodeStarted: len(nodeReasons) > 0,
		NodeReasons: nodeReasons,
	}, nil
}

func LoadConfig(
	ctx context.Context,
	reader ArtifactReader,
	root string,
	configPath string,
) (projectindex.ProjectStaticIndexConfig, error) {
	if reader == nil {
		return projectindex.ProjectStaticIndexConfig{}, fmt.Errorf("Static Index config reader is not configured")
	}
	req := requestwire.Request{
		Method:     "inspectProjectStaticIndexConfig",
		Root:       root,
		ConfigPath: configPath,
	}
	resp, err := reader.ReadArtifact(ctx, req, projectindex.ProjectIndexArtifactStaticIndexConfig)
	if err != nil {
		return projectindex.ProjectStaticIndexConfig{}, err
	}
	var config projectindex.ProjectStaticIndexConfig
	if err := json.Unmarshal(resp, &config); err != nil {
		return projectindex.ProjectStaticIndexConfig{}, fmt.Errorf("decode project Static Index config: %w", err)
	}
	if err := validateConfigDependencies(root, config.ConfigDependencies); err != nil {
		return projectindex.ProjectStaticIndexConfig{}, err
	}
	return config, nil
}

const maxConfigDependencies = 64

func validateConfigDependencies(root string, dependencies []string) error {
	if len(dependencies) > maxConfigDependencies {
		return fmt.Errorf("decode project Static Index config: too many config dependencies")
	}
	for _, dependency := range dependencies {
		if dependency == "" || filepath.IsAbs(dependency) || filepath.Clean(dependency) != filepath.FromSlash(dependency) {
			return fmt.Errorf("decode project Static Index config: invalid config dependency %q", dependency)
		}
		path := filepath.Join(root, filepath.FromSlash(dependency))
		relative, err := filepath.Rel(root, path)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return fmt.Errorf("decode project Static Index config: config dependency escapes root")
		}
	}
	return nil
}
