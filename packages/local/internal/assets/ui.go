package assets

import (
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"strings"
)

// UIOptions configures the local devtools UI handler.
type UIOptions struct {
	// EmbeddedFS is the filesystem containing the generated UI assets.
	EmbeddedFS fs.FS
	// EmbeddedDir is the directory inside EmbeddedFS that contains index.html.
	// It defaults to "ui-embed".
	EmbeddedDir string
	// StaticDir overrides embedded assets for local frontend development.
	// It defaults to CRUX_STATIC_DIR.
	StaticDir string
}

// UIHandler serves the local devtools single-page app from CRUX_STATIC_DIR when
// present, then falls back to the embedded UI filesystem. It returns nil only
// when neither source is available.
func UIHandler(options UIOptions) http.Handler {
	staticDir := options.StaticDir
	if staticDir == "" {
		staticDir = os.Getenv("CRUX_STATIC_DIR")
	}
	if staticDir != "" {
		if info, err := os.Stat(staticDir); err == nil && info.IsDir() {
			slog.Info("serving UI from disk", "path", staticDir)
			return spaHandler(http.FileServer(http.Dir(staticDir)))
		}
	}

	if options.EmbeddedFS == nil {
		return nil
	}
	embeddedDir := options.EmbeddedDir
	if embeddedDir == "" {
		embeddedDir = "ui-embed"
	}
	subFS, err := fs.Sub(options.EmbeddedFS, embeddedDir)
	if err != nil {
		slog.Warn("no embedded UI available")
		return nil
	}
	if !hasEmbeddedContent(subFS) {
		slog.Info("embedded UI is empty, serving fallback page")
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte(`<!DOCTYPE html><html><body>
				<h1>Crux Devtools</h1>
				<p>UI not built. Run <code>pnpm --filter @crux/devtools build</code> and rebuild the CLI.</p>
			</body></html>`))
		})
	}

	slog.Info("serving embedded UI")
	return spaHandler(http.FileServer(http.FS(subFS)))
}

func hasEmbeddedContent(fsys fs.FS) bool {
	entries, _ := fs.ReadDir(fsys, ".")
	for _, entry := range entries {
		if entry.Name() != ".gitkeep" {
			return true
		}
	}
	return false
}

func spaHandler(fileServer http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})
}
