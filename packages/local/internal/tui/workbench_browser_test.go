package tui

import (
	"context"
	"errors"
	"strings"
	"testing"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/startup"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
)

func TestWorkbenchShowsTypedStartupDiagnostic(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(120, 30)
	w.SetStartupSnapshot(startup.Snapshot{Diagnostics: []startup.Diagnostic{{
		ID: "runtime-host-only", Code: "RUNTIME_HOST_ONLY", Severity: "warning",
		Message: "Runtime setup requires its configured host.", Remediation: "Generate the configured host handlers.",
	}}})

	view := ansi.Strip(w.View())
	if !strings.Contains(view, "RUNTIME_HOST_ONLY") || !strings.Contains(view, "Generate the configured") {
		t.Fatalf("startup diagnostic was not visible in workbench:\n%s", view)
	}
}

func TestWorkspaceOpenBrowserCallsInjectedCapabilityOnce(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	calls := 0
	w.SetBrowserOpener("http://localhost:4400?t=session", func(_ context.Context, url string) error {
		calls++
		if url != "http://localhost:4400?t=session" {
			t.Fatalf("browser URL = %q", url)
		}
		return nil
	})

	cmd := w.Update(tea.KeyPressMsg(tea.Key{Text: "o", Code: 'o'}))
	if cmd == nil {
		t.Fatal("workspace o did not return a browser command")
	}
	if calls != 0 {
		t.Fatalf("browser calls before command execution = %d", calls)
	}
	if next := w.Update(cmd()); next != nil {
		t.Fatal("browser failure returned a terminating or follow-up command")
	}
	if calls != 1 {
		t.Fatalf("browser calls = %d, want 1", calls)
	}
}

func TestWorkspaceOpenBrowserCannotBeShadowedByWorkflowAction(t *testing.T) {
	workflowCalls := 0
	browserCalls := 0
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.screens["overview"] = &fakeActionScreen{
		fakeScreen: &fakeScreen{id: "overview"},
		actions: []interaction.Action{{
			ID:      "workflow.conflict",
			Binding: key.NewBinding(key.WithKeys("o")),
			Run: func() tea.Cmd {
				workflowCalls++
				return nil
			},
		}},
	}
	w.SetBrowserOpener("http://localhost:4400", func(context.Context, string) error {
		browserCalls++
		return nil
	})

	cmd := w.Update(tea.KeyPressMsg(tea.Key{Text: "o", Code: 'o'}))
	if cmd == nil {
		t.Fatal("workspace o did not return a browser command")
	}
	w.Update(cmd())

	if browserCalls != 1 || workflowCalls != 0 {
		t.Fatalf("browser calls = %d, workflow calls = %d; want 1, 0", browserCalls, workflowCalls)
	}
}

func TestWorkspaceOpenBrowserFailureIsVisibleAndNonFatal(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(120, 30)
	w.SetBrowserOpener("http://localhost:4400", func(context.Context, string) error {
		return errors.New("launcher unavailable")
	})

	cmd := w.Update(tea.KeyPressMsg(tea.Key{Text: "o", Code: 'o'}))
	if cmd == nil {
		t.Fatal("workspace o did not return a browser command")
	}
	w.Update(cmd())

	view := ansi.Strip(w.View())
	if !strings.Contains(view, "browser launch failed: launcher unavailable") {
		t.Fatalf("browser failure was not visible:\n%s", view)
	}
}

func TestWorkspaceOpenBrowserFailureIsSafeAndBoundedAtMinimumWidth(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(70, 24)
	w.SetBrowserOpener("http://localhost:4400", func(context.Context, string) error {
		return errors.New("\x1b[31mlauncher\n" + strings.Repeat("界", 1000))
	})

	cmd := w.Update(tea.KeyPressMsg(tea.Key{Text: "o", Code: 'o'}))
	w.Update(cmd())
	view := w.View()
	plain := ansi.Strip(view)

	if strings.Contains(view, "\x1b[31mlauncher") || !strings.Contains(plain, "browser launch failed: launcher") {
		t.Fatalf("browser failure was not safely visible:\n%q", plain)
	}
	if width := lipgloss.Width(w.browserStatus); width > 256 {
		t.Fatalf("stored browser status width = %d, want <= 256", width)
	}
	for lineNumber, line := range strings.Split(view, "\n") {
		if width := lipgloss.Width(line); width > 70 {
			t.Fatalf("line %d width = %d, want <= 70:\n%q", lineNumber+1, width, ansi.Strip(line))
		}
	}
}

func TestWorkspaceOpenBrowserYieldsToEditorAndClaimedPrefix(t *testing.T) {
	t.Run("Runs filter receives o", func(t *testing.T) {
		calls := 0
		w := newTestWorkbench(nil, nil, "http://localhost:4400")
		w.activeNav = "runs"
		w.SetBrowserOpener("http://localhost:4400", func(context.Context, string) error {
			calls++
			return nil
		})

		w.Update(tea.KeyPressMsg(tea.Key{Text: "/", Code: '/'}))
		w.Update(tea.KeyPressMsg(tea.Key{Text: "o", Code: 'o'}))

		if calls != 0 {
			t.Fatalf("browser calls while filtering = %d", calls)
		}
	})

	t.Run("g o navigates Overview", func(t *testing.T) {
		calls := 0
		w := newTestWorkbench(nil, nil, "http://localhost:4400")
		w.activeNav = "runs"
		w.SetBrowserOpener("http://localhost:4400", func(context.Context, string) error {
			calls++
			return nil
		})

		w.Update(tea.KeyPressMsg(tea.Key{Text: "g", Code: 'g'}))
		w.Update(tea.KeyPressMsg(tea.Key{Text: "o", Code: 'o'}))

		if calls != 0 {
			t.Fatalf("browser calls for g o = %d", calls)
		}
		if w.activeNav != "overview" {
			t.Fatalf("active nav = %q, want overview", w.activeNav)
		}
	})
}

func TestWorkspaceOpenBrowserIsHiddenWithoutCapability(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	for _, action := range w.workspaceActions() {
		if action.ID == "workspace.open-browser" {
			t.Fatal("workspace browser action exposed without an opener")
		}
	}
}
