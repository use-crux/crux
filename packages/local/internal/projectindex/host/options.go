package host

// WorkerAssets carries embedded worker script contents owned by the caller.
type WorkerAssets struct {
	ProjectIndexer         []byte
	ProjectSemanticIndexer []byte
	ProjectRuntimeIndexer  []byte
}

// WorkerOptions configures Project Index worker processes without coupling the
// indexer package to the server package that embeds production assets.
type WorkerOptions struct {
	ProjectIndexerScript         string
	ProjectSemanticIndexerScript string
	ProjectRuntimeIndexerScript  string
	Assets                       WorkerAssets
}
