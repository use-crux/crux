package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/projectindex/oneshot"
	"github.com/use-crux/crux/packages/local/internal/projectroot"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type projectIndexRunFunc func(context.Context, oneshot.Options, commandWorkerProcess) (oneshot.Result, error)

var runProjectIndexForCommand projectIndexRunFunc = runProjectIndexWithEmbeddedWorkers

func runProjectIndexWithEmbeddedWorkers(ctx context.Context, options oneshot.Options, process commandWorkerProcess) (result oneshot.Result, err error) {
	root, err := validateOneShotProjectRoot(options.Root, options.ConfigPath)
	if err != nil {
		return oneshot.Result{}, err
	}
	options.Root = root
	indexer := assets.NewEmbeddedProjectIndexer("", process.options()...)
	defer func() {
		if closeErr := indexer.Close(); err == nil && closeErr != nil {
			err = fmt.Errorf("close Project Index workers: %w", closeErr)
		}
	}()
	return oneshot.New(indexer, nil).Run(ctx, options)
}

func validateOneShotProjectRoot(root, configPath string) (string, error) {
	if root == "" {
		root = "."
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolve project root %q: %w", root, err)
	}
	absolute = filepath.Clean(absolute)
	info, err := os.Stat(absolute)
	if err != nil {
		return "", fmt.Errorf("inspect project root %q: %w", absolute, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("project root %q is not a directory", absolute)
	}
	if configPath != "" {
		candidate := configPath
		if !filepath.IsAbs(candidate) {
			candidate = filepath.Join(absolute, candidate)
		}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return absolute, nil
		}
	}
	for _, name := range projectroot.ConfigNames {
		if info, err := os.Stat(filepath.Join(absolute, name)); err == nil && !info.IsDir() {
			return absolute, nil
		}
	}
	if info, err := os.Stat(filepath.Join(absolute, "package.json")); err == nil && !info.IsDir() {
		return absolute, nil
	}
	return "", fmt.Errorf(
		"this directory doesn't look like a Crux project (no crux config or package.json found at %s)",
		absolute,
	)
}

func projectIndexAPI(index store.IndexData) (api.IndexData, error) {
	data, err := json.Marshal(index)
	if err != nil {
		return api.IndexData{}, fmt.Errorf("encode Project Index command result: %w", err)
	}
	var result api.IndexData
	if err := json.Unmarshal(data, &result); err != nil {
		return api.IndexData{}, fmt.Errorf("decode Project Index command result: %w", err)
	}
	return result, nil
}
