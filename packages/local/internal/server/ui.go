package server

import (
	"embed"
	"net/http"

	"github.com/use-crux/crux/packages/local/internal/assets"
)

//go:embed ui-embed/*
var embeddedUI embed.FS

// UIHandler returns an HTTP handler that serves the React UI.
// It first checks CRUX_STATIC_DIR for a disk-based UI (dev mode),
// then falls back to the embedded UI assets.
// Returns nil if no UI is available (both empty).
func UIHandler() http.Handler {
	return assets.UIHandler(assets.UIOptions{
		EmbeddedFS: embeddedUI,
	})
}
