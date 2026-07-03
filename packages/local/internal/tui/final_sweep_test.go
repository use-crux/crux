package tui

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestFinalSweepRetiredMarkerFilesRemoved(t *testing.T) {
	for _, name := range []string{
		"detail.go",
		"tree.go",
		"view_dashboard.go",
		"view_index.go",
	} {
		if _, err := os.Stat(filepath.Join(".", name)); !os.IsNotExist(err) {
			t.Fatalf("%s still exists; retired marker files should be deleted in the final sweep", name)
		}
	}
}

func TestBootViewsFuzzResize(t *testing.T) {
	uitest.FuzzResize(t, func(width, height int) string {
		app := NewApp("http://localhost:4400", nil, "local", true)
		app.ready = true
		app.width = width
		app.height = height
		app.bootLogs = []string{"server ready", "quality worker ready"}
		app.startupSummary = "go-native http=12ms ui=8ms total=20ms"
		return app.viewContent()
	})

	uitest.FuzzResize(t, func(width, height int) string {
		app := NewApp("http://localhost:4400", nil, "local", true)
		app.ready = true
		app.width = width
		app.height = height
		app.bootError = strings.Repeat("startup failed ", 8)
		app.bootLogs = []string{"server failed"}
		app.startupSummary = "go-native http=12ms ui=8ms total=20ms"
		return app.viewContent()
	})
}
