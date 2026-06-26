package record

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/syntax"
)

func Collect(ctx context.Context, parser syntax.Parser, plan projectindex.ProjectStaticSyntaxPlan) ([]json.RawMessage, error) {
	if parser == nil {
		return nil, fmt.Errorf("project syntax parser is not configured")
	}
	files := Files(plan)
	records := make([]json.RawMessage, len(files))
	if len(files) == 0 {
		return records, nil
	}
	if batchParser, ok := parser.(syntax.BatchParser); ok {
		return batchParser.ParseFiles(ctx, ParseRequests(plan))
	}

	concurrency := parser.Concurrency()
	if concurrency < 1 {
		concurrency = 1
	}
	if concurrency > len(files) {
		concurrency = len(files)
	}

	type job struct {
		index int
		file  string
	}

	parseCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	jobs := make(chan job)
	var wg sync.WaitGroup
	var errOnce sync.Once
	var firstErr error
	setErr := func(err error) {
		errOnce.Do(func() {
			firstErr = err
			cancel()
		})
	}

	for range concurrency {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				if err := parseCtx.Err(); err != nil {
					setErr(err)
					return
				}
				record, err := parseFile(parseCtx, parser, plan, job.file)
				if err != nil {
					setErr(err)
					return
				}
				records[job.index] = record
			}
		}()
	}

sendJobs:
	for index, file := range files {
		select {
		case <-parseCtx.Done():
			break sendJobs
		case jobs <- job{index: index, file: file}:
		}
	}
	close(jobs)
	wg.Wait()

	if firstErr != nil {
		return nil, firstErr
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return records, nil
}

func parseFile(ctx context.Context, parser syntax.Parser, plan projectindex.ProjectStaticSyntaxPlan, file string) (json.RawMessage, error) {
	source, err := os.ReadFile(file)
	if err != nil {
		return nil, fmt.Errorf("read source for native syntax record %s: %w", file, err)
	}
	record, err := parser.ParseFile(ctx, syntax.Request{
		Root:                     plan.Root,
		File:                     file,
		Source:                   string(source),
		CallNames:                plan.CallNames,
		CallInterests:            CallInterests(plan.CallInterests),
		ConstructorNames:         plan.ConstructorNames,
		ConstructorInterests:     ConstructorInterests(plan.ConstructorInterests),
		PruneNativeFactCallNames: plan.PruneNativeFactCallNames,
	})
	if err != nil {
		return nil, fmt.Errorf("parse native syntax record %s: %w", file, err)
	}
	return record, nil
}
