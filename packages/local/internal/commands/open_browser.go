package commands

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"

	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/tui"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
)

func platformBrowserOpener() tui.BrowserOpener {
	var command string
	var arguments func(string) []string
	switch runtime.GOOS {
	case "darwin":
		command = "open"
		arguments = func(url string) []string { return []string{url} }
	case "linux":
		command = "xdg-open"
		arguments = func(url string) []string { return []string{url} }
	case "windows":
		command = "cmd"
		arguments = func(url string) []string { return []string{"/c", "start", url} }
	default:
		return nil
	}
	return func(ctx context.Context, url string) error {
		if err := exec.CommandContext(ctx, command, arguments(url)...).Run(); err != nil {
			return fmt.Errorf("%s: %w", command, err)
		}
		return nil
	}
}

func launchBrowser(ctx context.Context, io *output.IO, requested bool, url string, opener tui.BrowserOpener) {
	if !requested {
		return
	}
	if opener == nil {
		devStatusf(io, "%s Browser launch unavailable on this platform\n", devBullet(io))
		return
	}
	if err := opener(ctx, url); err != nil {
		prefix := fmt.Sprintf("%s Browser launch failed: ", devBullet(io))
		available := io.Width() - ansi.StringWidth(prefix)
		message := kit.Truncate(kit.SanitizeInline(err.Error()), available, "…")
		devStatusf(io, "%s%s\n", prefix, message)
	}
}
