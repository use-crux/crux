package tui

import (
	"context"
	"fmt"
	"strings"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// BrowserOpener launches the browser devtools URL. It is injected at the
// process boundary so Workbench construction and input handling stay free of
// process-global side effects.
type BrowserOpener func(context.Context, string) error

type browserResultMsg struct {
	Status string
}

// SetBrowserOpener enables browser launching in the post-boot Workbench.
func (a *App) SetBrowserOpener(browserURL string, opener BrowserOpener) {
	a.workbench.SetBrowserOpener(browserURL, opener)
}

// SetBrowserOpener enables the workspace browser action for browserURL. A nil
// opener keeps the capability hidden from dispatch and contextual help.
func (w *Workbench) SetBrowserOpener(browserURL string, opener BrowserOpener) {
	w.browserURL = browserURL
	w.openBrowser = opener
}

func (w *Workbench) browserAction() interaction.Action {
	return interaction.Action{
		ID:      "workspace.open-browser",
		Binding: browserBinding(),
		Run: func() tea.Cmd {
			ctx, url, opener := w.ctx, w.browserURL, w.openBrowser
			return func() tea.Msg {
				if err := opener(ctx, url); err != nil {
					return browserResultMsg{Status: "browser launch failed: " + err.Error()}
				}
				return browserResultMsg{Status: "opened browser devtools"}
			}
		},
	}
}

func (w *Workbench) handleBrowserResult(result browserResultMsg) tea.Cmd {
	w.browserStatus = kit.Truncate(kit.SanitizeInline(result.Status), 256, "…")
	return nil
}

func (w *Workbench) statusBadge() shell.StatusBadge {
	if w.startupDiagnostic != nil {
		count := len(w.startupDiagnostic.Children)
		if count == 0 {
			count = 1
		}
		return shell.StatusBadge{
			Full:    fmt.Sprintf("⚠ %d %s · ! details", count, kit.Pluralize(count, "issue")),
			Compact: fmt.Sprintf("⚠%d !", count),
			Warning: true,
		}
	}
	if w.browserStatus != "" {
		badge := shell.StatusBadge{Full: w.browserStatus}
		if strings.HasPrefix(w.browserStatus, "browser launch failed") {
			badge.Compact = "browser launch failed"
			badge.Warning = true
		}
		return badge
	}
	return shell.StatusBadge{}
}
