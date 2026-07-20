package localserver

import (
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/server/source"
)

func registerSourceRoutes(mux *http.ServeMux, options SourceResolverOptions, projectRoot string) {
	source.RegisterRoutes(mux, options.ScriptPath, options.EmbeddedScript, projectRoot, options.Logger, options.Stderr)
}
