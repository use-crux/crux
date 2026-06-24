package staticplan

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/indexwire"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/statichost"
)

const (
	ReasonConfig     = "native-static-config"
	ReasonExtensions = "native-static-extensions"
)

type ArtifactReader interface {
	ReadArtifact(context.Context, indexwire.Request, projectindex.ProjectIndexArtifactKind) (json.RawMessage, error)
}

type ArtifactReaderFunc func(context.Context, indexwire.Request, projectindex.ProjectIndexArtifactKind) (json.RawMessage, error)

func (f ArtifactReaderFunc) ReadArtifact(ctx context.Context, request indexwire.Request, artifact projectindex.ProjectIndexArtifactKind) (json.RawMessage, error) {
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
	config := projectindex.ProjectNativeStaticConfig{Root: root}
	timings := []projectindex.ProjectIndexPhaseTiming{}
	nodeReasons := []string{}
	if ConfigMayRequireNode(root, configPath) {
		configStarted := time.Now()
		if loaded, ok, err := InspectSimpleConfig(root, configPath); err != nil {
			return InspectResult{}, err
		} else if ok {
			config = loaded
		} else {
			loaded, err := LoadConfig(ctx, reader, root, configPath)
			if err != nil {
				return InspectResult{}, err
			}
			config = loaded
			nodeReasons = append(nodeReasons, ReasonConfig)
		}
		timings = AppendTiming(timings, TimingConfig, configStarted, 1)
	}

	var extensionManifest *projectindex.StaticExtensionHostManifestResult
	if len(config.Extensions) > 0 && config.NativeAstEnabled {
		manifestStarted := time.Now()
		manifest, err := statichost.LoadManifest(ctx, statichost.ArtifactReaderFunc(reader.ReadArtifact), root, configPath)
		if err != nil {
			return InspectResult{}, err
		}
		extensionManifest = &manifest
		timings = AppendTiming(timings, TimingExtensionManifest, manifestStarted, 1)
		nodeReasons = append(nodeReasons, ReasonExtensions)
	}

	planResult, err := BuildWithExtensionManifest(root, projectName, config, extensionManifest)
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
) (projectindex.ProjectNativeStaticConfig, error) {
	if reader == nil {
		return projectindex.ProjectNativeStaticConfig{}, fmt.Errorf("native static config reader is not configured")
	}
	req := indexwire.Request{
		Method:     "inspectProjectNativeStaticConfig",
		Root:       root,
		ConfigPath: configPath,
	}
	resp, err := reader.ReadArtifact(ctx, req, projectindex.ProjectIndexArtifactNativeStaticConfig)
	if err != nil {
		return projectindex.ProjectNativeStaticConfig{}, err
	}
	var config projectindex.ProjectNativeStaticConfig
	if err := json.Unmarshal(resp, &config); err != nil {
		return projectindex.ProjectNativeStaticConfig{}, fmt.Errorf("decode project native static config: %w", err)
	}
	return config, nil
}
