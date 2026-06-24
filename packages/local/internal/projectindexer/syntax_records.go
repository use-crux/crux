package projectindexer

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/projectindexer/syntax"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

func (w *Worker) collectProjectSyntaxRecords(ctx context.Context, plan devtools.ProjectStaticSyntaxPlan) ([]json.RawMessage, error) {
	if w.syntaxParser == nil {
		return nil, fmt.Errorf("project syntax parser is not configured")
	}
	files := projectSyntaxPlanFilesToParse(plan)
	records := make([]json.RawMessage, len(files))
	if len(files) == 0 {
		return records, nil
	}
	if batchParser, ok := w.syntaxParser.(syntax.BatchParser); ok {
		return w.collectProjectSyntaxRecordsBatch(ctx, plan, batchParser)
	}

	concurrency := w.syntaxParser.Concurrency()
	if concurrency < 1 {
		concurrency = 1
	}
	if concurrency > len(files) {
		concurrency = len(files)
	}

	type syntaxJob struct {
		index int
		file  string
	}

	parseCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	jobs := make(chan syntaxJob)
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
				record, err := w.parseProjectSyntaxRecord(parseCtx, plan, job.file)
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
		case jobs <- syntaxJob{index: index, file: file}:
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

func (w *Worker) collectProjectSyntaxRecordsBatch(ctx context.Context, plan devtools.ProjectStaticSyntaxPlan, parser syntax.BatchParser) ([]json.RawMessage, error) {
	return parser.ParseFiles(ctx, projectSyntaxParseRequestsFromPlan(plan))
}

func projectSyntaxParseRequestsFromPlan(plan devtools.ProjectStaticSyntaxPlan) []syntax.Request {
	files := projectSyntaxPlanFilesToParse(plan)
	requests := make([]syntax.Request, 0, len(files))
	for _, file := range files {
		requests = append(requests, syntax.Request{
			Root:                     plan.Root,
			File:                     file,
			ReadSourceFromDisk:       true,
			CallNames:                plan.CallNames,
			CallInterests:            projectSyntaxCallInterests(plan.CallInterests),
			ConstructorNames:         plan.ConstructorNames,
			ConstructorInterests:     projectSyntaxConstructorInterests(plan.ConstructorInterests),
			PruneNativeFactCallNames: plan.PruneNativeFactCallNames,
		})
	}
	return requests
}

func projectSyntaxPlanFilesToParse(plan devtools.ProjectStaticSyntaxPlan) []string {
	if plan.FilesToParse != nil {
		return plan.FilesToParse
	}
	return plan.Files
}

func (w *Worker) parseProjectSyntaxRecord(ctx context.Context, plan devtools.ProjectStaticSyntaxPlan, file string) (json.RawMessage, error) {
	source, err := os.ReadFile(file)
	if err != nil {
		return nil, fmt.Errorf("read source for native syntax record %s: %w", file, err)
	}
	record, err := w.syntaxParser.ParseFile(ctx, syntax.Request{
		Root:                     plan.Root,
		File:                     file,
		Source:                   string(source),
		CallNames:                plan.CallNames,
		CallInterests:            projectSyntaxCallInterests(plan.CallInterests),
		ConstructorNames:         plan.ConstructorNames,
		ConstructorInterests:     projectSyntaxConstructorInterests(plan.ConstructorInterests),
		PruneNativeFactCallNames: plan.PruneNativeFactCallNames,
	})
	if err != nil {
		return nil, fmt.Errorf("parse native syntax record %s: %w", file, err)
	}
	return record, nil
}

func projectSyntaxCallInterests(input []devtools.StaticCallInterest) []syntax.CallInterest {
	if len(input) == 0 {
		return nil
	}
	interests := make([]syntax.CallInterest, 0, len(input))
	for _, interest := range input {
		interests = append(interests, syntax.CallInterest{
			Name:       interest.Name,
			ImportFrom: append([]string(nil), interest.ImportFrom...),
			ConfigArg:  interest.ConfigArg,
			Properties: append([]string(nil), interest.Properties...),
			Callbacks:  projectSyntaxCallbackInterests(interest.Callbacks),
			Source:     interest.Source,
		})
	}
	return interests
}

func projectSyntaxConstructorInterests(input []devtools.StaticConstructorInterest) []syntax.ConstructorInterest {
	if len(input) == 0 {
		return nil
	}
	interests := make([]syntax.ConstructorInterest, 0, len(input))
	for _, interest := range input {
		interests = append(interests, syntax.ConstructorInterest{
			Name:       interest.Name,
			ImportFrom: append([]string(nil), interest.ImportFrom...),
			ConfigArg:  interest.ConfigArg,
			Properties: append([]string(nil), interest.Properties...),
			Callbacks:  projectSyntaxCallbackInterests(interest.Callbacks),
			Source:     interest.Source,
		})
	}
	return interests
}

func projectSyntaxCallbackInterests(input []devtools.StaticCallbackInterest) []syntax.CallbackInterest {
	if len(input) == 0 {
		return nil
	}
	interests := make([]syntax.CallbackInterest, 0, len(input))
	for _, interest := range input {
		interests = append(interests, syntax.CallbackInterest{
			Property: interest.Property,
			MaxDepth: interest.MaxDepth,
		})
	}
	return interests
}

// IndexProjectAstFromSyntaxRecordsPatch projects native static syntax records
// through the explicit legacy TypeScript compatibility path.
func (w *Worker) IndexProjectAstFromSyntaxRecordsPatch(ctx context.Context, root, configPath, projectName string, records []json.RawMessage, syntaxFrontend ...*devtools.SyntaxFrontend) (devtools.IndexPatch, error) {
	var identity *devtools.SyntaxFrontend
	if len(syntaxFrontend) > 0 {
		identity = syntaxFrontend[0]
	}
	return w.indexProjectAstFromSyntaxRecordsPatch(ctx, root, configPath, projectName, records, identity, nil)
}

func (w *Worker) indexProjectAstFromSyntaxRecordsPatch(ctx context.Context, root, configPath, projectName string, records []json.RawMessage, identity *devtools.SyntaxFrontend, staticCacheHits []devtools.StaticCacheHit) (devtools.IndexPatch, error) {
	req := projectIndexRequest{
		Method:          "indexProjectAstFromSyntaxRecords",
		Root:            root,
		ConfigPath:      configPath,
		ProjectName:     projectName,
		ResolutionMode:  "source-only",
		SyntaxRecords:   records,
		SyntaxFrontend:  identity,
		StaticCacheHits: staticCacheHits,
	}
	patches, err := w.streamPatches(ctx, req, devtools.IndexPatchBudget{})
	if err != nil {
		return devtools.IndexPatch{}, err
	}
	if len(patches) != 1 {
		return devtools.IndexPatch{}, fmt.Errorf("project ast syntax-record worker returned %d patches, want 1", len(patches))
	}
	return patches[0], nil
}
