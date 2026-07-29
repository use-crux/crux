package localserver

import (
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/devtools/promptpreview"
	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
)

func registerPromptPreviewRoutes(
	mux *http.ServeMux,
	devtoolsService *devtools.Service,
	runtimeBridge *runtimebridge.Service,
) {
	if devtoolsService == nil {
		return
	}
	promptpreview.RegisterRoutes(
		mux,
		promptpreview.New(devtoolsService, runtimeBridge),
	)
}
