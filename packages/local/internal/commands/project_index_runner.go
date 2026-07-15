package commands

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/assets"
	"github.com/use-crux/crux/packages/local/internal/projectindex/oneshot"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type projectIndexRunFunc func(context.Context, oneshot.Options) (oneshot.Result, error)

var runProjectIndexForCommand projectIndexRunFunc = runProjectIndexWithEmbeddedWorkers

func runProjectIndexWithEmbeddedWorkers(ctx context.Context, options oneshot.Options) (result oneshot.Result, err error) {
	indexer := assets.NewEmbeddedProjectIndexer("")
	defer func() {
		if closeErr := indexer.Close(); err == nil && closeErr != nil {
			err = fmt.Errorf("close Project Index workers: %w", closeErr)
		}
	}()
	return oneshot.New(indexer, nil).Run(ctx, options)
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
