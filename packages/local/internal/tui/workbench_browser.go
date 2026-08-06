package tui

import (
	"context"
	"fmt"
	"strings"
	"time"

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

type statusToastExpiredMsg struct {
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
	return w.showStatusToast(result.Status, 4*time.Second)

}

func (w *Workbench) showStatusToast(value string, duration time.Duration) tea.Cmd {
	w.statusToast = kit.Truncate(kit.SanitizeInline(value), 256, "…")
	status := w.statusToast
	return tea.Tick(duration, func(time.Time) tea.Msg {
		return statusToastExpiredMsg{Status: status}
	})
}

func (w *Workbench) statusBadge() shell.StatusBadge {
	if w.statusToast != "" {
		badge := shell.StatusBadge{Full: w.statusToast}
		if strings.HasPrefix(w.statusToast, "browser launch failed") {
			badge.Compact = kit.TruncateWords(w.statusToast, 19, "…")
			badge.Warning = true
		}
		return badge
	}
	if w.pendingPrefix == "g" {
		return shell.StatusBadge{}
	}
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
	return shell.StatusBadge{}
}
