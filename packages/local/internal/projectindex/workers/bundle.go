package workers

import (
	"errors"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/frontend"
	"github.com/use-crux/crux/packages/local/internal/projectindex/workers/node"
	runtimeworker "github.com/use-crux/crux/packages/local/internal/projectindex/workers/runtime"
	semanticworker "github.com/use-crux/crux/packages/local/internal/projectindex/workers/semantic"
)

// Bundle composes the Project Index TypeScript worker phase clients (source,
// semantic, runtime) used by local indexing.
type Bundle struct {
	scriptPath     string
	scriptContent  []byte
	worker         *workerproc.Worker
	semanticWorker *semanticworker.Worker
	runtimeWorker  *runtimeworker.Worker
	syntaxParser   frontend.Parser
	timingsMu      sync.Mutex
	lastAstTiming  ProjectIndexAstTiming
	planMu         sync.Mutex
	activePlan     *projectStaticSyntaxPlanCall
}

const (
	workerMaxResponseLineBytes   = 16 * 1024 * 1024
	workerMaxResponseStreamBytes = 128 * 1024 * 1024
	workerProducer               = "@use-crux/indexer/project-indexer"
)

// New creates a Project Index worker bundle backed by the configured workers.
func New(options BundleOptions) *Bundle {
	return &Bundle{
		scriptPath:    options.ProjectIndexerScript,
		scriptContent: options.Assets.ProjectIndexer,
		worker:        node.NewWorker("project-indexer", options.Assets.ProjectIndexer, options.ProjectIndexerScript, workerMaxResponseLineBytes, options.ProcessOptions...),
		semanticWorker: semanticworker.New(semanticworker.Options{
			ScriptPath:     options.ProjectSemanticIndexerScript,
			ScriptContent:  options.Assets.ProjectSemanticIndexer,
			ProcessOptions: options.ProcessOptions,
		}),
		runtimeWorker: runtimeworker.New(runtimeworker.Options{
			ScriptPath:     options.ProjectRuntimeIndexerScript,
			ScriptContent:  options.Assets.ProjectRuntimeIndexer,
			ProcessOptions: options.ProcessOptions,
		}),
		syntaxParser: syntaxWorkerFromEnv(options.ProcessOptions),
	}
}

// Close shuts down every worker owned by the bundle.
func (w *Bundle) Close() error {
	var closeErrs []error
	if w.worker != nil {
		if err := w.worker.Close(); err != nil {
			closeErrs = append(closeErrs, err)
		}
	}
	if w.semanticWorker != nil {
		if err := w.semanticWorker.Close(); err != nil {
			closeErrs = append(closeErrs, err)
		}
	}
	if w.runtimeWorker != nil {
		if err := w.runtimeWorker.Close(); err != nil {
			closeErrs = append(closeErrs, err)
		}
	}
	if w.syntaxParser != nil {
		if err := w.syntaxParser.Close(); err != nil {
			closeErrs = append(closeErrs, err)
		}
	}
	return errors.Join(closeErrs...)
}
