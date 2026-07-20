package workers

import "github.com/use-crux/crux/packages/local/internal/process/workerproc"

// BundleAssets carries embedded worker script contents owned by the caller.
type BundleAssets struct {
	ProjectIndexer         []byte
	ProjectSemanticIndexer []byte
	ProjectRuntimeIndexer  []byte
}

// BundleOptions configures Project Index worker processes without coupling the
// indexer package to the server package that embeds production assets.
type BundleOptions struct {
	ProjectIndexerScript         string
	ProjectSemanticIndexerScript string
	ProjectRuntimeIndexerScript  string
	Assets                       BundleAssets
	// ProcessOptions are applied to every Node worker owned by the bundle.
	ProcessOptions []workerproc.Option
}
