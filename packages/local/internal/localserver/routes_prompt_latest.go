package localserver

import (
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/devtools/promptlatest"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
)

func wrapPromptLatestRunRoute(
	next http.Handler,
	devtoolsService *devtools.Service,
	observabilityService *observability.Service,
	runtimeBridge *runtimebridge.Service,
) http.Handler {
	if devtoolsService == nil || observabilityService == nil {
		return next
	}
	service := promptlatest.New(
		devtoolsService,
		observabilityService,
		runtimeBridge,
	)
	return promptlatest.NewHandler(next, service)
}
