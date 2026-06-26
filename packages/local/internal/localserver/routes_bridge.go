package localserver

import (
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
	"github.com/use-crux/crux/packages/local/internal/server/bridge"
)

func registerRuntimeBridgeRoutes(
	mux *http.ServeMux,
	runtimeBridge *runtimebridge.Service,
	originAllowed func(*http.Request) bool,
) {
	mux.HandleFunc("/ws/runtime", bridge.UpgradeHandler(runtimeBridge, originAllowed))
	bridge.RegisterRoutes(mux, runtimeBridge)
}
