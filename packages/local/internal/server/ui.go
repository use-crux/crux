package server

import (
	"embed"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"strings"
)

//go:embed ui-embed/*
var embeddedUI embed.FS

// UIHandler returns an HTTP handler that serves the React UI.
// It first checks CRUX_STATIC_DIR for a disk-based UI (dev mode),
// then falls back to the embedded UI assets.
// Returns nil if no UI is available (both empty).
func UIHandler() http.Handler {
	// Check environment override for dev mode.
	if dir := os.Getenv("CRUX_STATIC_DIR"); dir != "" {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			slog.Info("serving UI from disk", "path", dir)
			return spaHandler(http.FileServer(http.Dir(dir)))
		}
	}

	// Try embedded UI.
	subFS, err := fs.Sub(embeddedUI, "ui-embed")
	if err != nil {
		slog.Warn("no embedded UI available")
		return nil
	}

	// Check if the embed actually has files (not just .gitkeep).
	entries, _ := fs.ReadDir(subFS, ".")
	hasContent := false
	for _, e := range entries {
		if e.Name() != ".gitkeep" {
			hasContent = true
			break
		}
	}
	if !hasContent {
		slog.Info("embedded UI is empty, serving fallback page")
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte(`<!DOCTYPE html><html><body>
				<h1>Crux Devtools</h1>
				<p>UI not built. Run <code>pnpm --filter @crux/devtools build</code> and rebuild the CLI.</p>
			</body></html>`))
		})
	}

	slog.Info("serving embedded UI")
	return spaHandler(http.FileServer(http.FS(subFS)))
}

// spaHandler wraps a file server to serve index.html for any path
// that doesn't match a static file (SPA client-side routing).
func spaHandler(fileServer http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Serve static assets directly.
		if strings.HasPrefix(r.URL.Path, "/assets/") ||
			strings.HasSuffix(r.URL.Path, ".js") ||
			strings.HasSuffix(r.URL.Path, ".css") ||
			strings.HasSuffix(r.URL.Path, ".svg") ||
			strings.HasSuffix(r.URL.Path, ".png") ||
			strings.HasSuffix(r.URL.Path, ".ico") ||
			strings.HasSuffix(r.URL.Path, ".woff2") ||
			strings.HasSuffix(r.URL.Path, ".map") {
			fileServer.ServeHTTP(w, r)
			return
		}

		// For all other paths, serve index.html (SPA routing).
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})
}
