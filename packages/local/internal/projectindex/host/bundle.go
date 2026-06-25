package host

import (
	"errors"
	"sync"

	nodeprocess "github.com/use-crux/crux/packages/local/internal/process/node"
	"github.com/use-crux/crux/packages/local/internal/projectindex/host/node"
	runtimeworker "github.com/use-crux/crux/packages/local/internal/projectindex/host/runtime"
	semanticworker "github.com/use-crux/crux/packages/local/internal/projectindex/host/semantic"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/syntax"
)

// Bundle composes the Project Index host phase clients used by local indexing.
type Bundle struct {
	scriptPath     string
	scriptContent  []byte
	worker         *nodeprocess.Worker
	semanticWorker *semanticworker.Worker
	runtimeWorker  *runtimeworker.Worker
	syntaxParser   syntax.Parser
	timingsMu      sync.Mutex
	lastAstTiming  ProjectIndexAstTiming
	planMu         sync.Mutex
	activePlan     *projectStaticSyntaxPlanCall
}

const workerMaxResponseBytes = 16 * 1024 * 1024
const workerProducer = "@crux/indexer/project-indexer"

// New creates a Project Index host bundle backed by the configured workers.
func New(options BundleOptions) *Bundle {
	return &Bundle{
		scriptPath:    options.ProjectIndexerScript,
		scriptContent: options.Assets.ProjectIndexer,
		worker:        node.NewWorker("project-indexer", options.Assets.ProjectIndexer, options.ProjectIndexerScript, workerMaxResponseBytes),
		semanticWorker: semanticworker.New(semanticworker.Options{
			ScriptPath:    options.ProjectSemanticIndexerScript,
			ScriptContent: options.Assets.ProjectSemanticIndexer,
		}),
		runtimeWorker: runtimeworker.New(runtimeworker.Options{
			ScriptPath:    options.ProjectRuntimeIndexerScript,
			ScriptContent: options.Assets.ProjectRuntimeIndexer,
		}),
		syntaxParser: syntaxWorkerFromEnv(),
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
