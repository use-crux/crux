package tui

import (
	"strings"
	"testing"
)

func TestWorkbenchBreadcrumbDevtoolsLinkIsAccentOnly(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4317")
	w.Resize(160, 30)

	out := w.View()

	if strings.Contains(out, "\x1b]8;;http://localhost:4317") {
		t.Errorf("View() wraps the local host label in OSC 8, which terminals decorate with an underline")
	}
	if strings.Contains(out, "\x1b[4m") {
		t.Errorf("View() underlines the local host label")
	}
	if !strings.Contains(out, "local localhost:4317") {
		t.Errorf("View() does not surface the compact local host label")
	}
	if !strings.Contains(out, "\x1b[38;2;95;227;200m") {
		t.Errorf("View() does not render the local host label in the accent tone")
	}
}

func TestWorkbenchBreadcrumbTunnelLinkIsHyperlink(t *testing.T) {
	const tunnelURL = "https://example.ngrok.app?t=session-token"
	w := newTestWorkbench(nil, nil, "http://localhost:4317")
	w.SetTunnelURL(tunnelURL)
	w.Resize(200, 30)

	out := w.View()

	const oscOpen = "\x1b]8;;https://example.ngrok.app?t=session-token\x07"
	if !strings.Contains(out, oscOpen) {
		t.Errorf("View() does not contain OSC 8 open sequence for the tunnel URL\nexpected to find %q in output", oscOpen)
	}
	if !strings.Contains(out, "tunnel example.ngrok.app") {
		t.Errorf("View() does not surface compact tunnel URL label\noutput head:\n%s", head(out, 240))
	}
}

func TestWorkbenchBreadcrumbSurfacesIngestTokenPath(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4317")
	w.SetIngestToken("secret-project-token", ".crux/devtools/ingest-token")
	w.Resize(200, 30)

	out := w.View()

	if !strings.Contains(out, "ingest token .crux/devtools/ingest-token") {
		t.Errorf("View() does not surface ingest token path\noutput head:\n%s", head(out, 240))
	}
	if strings.Contains(out, "secret-project-token") {
		t.Errorf("View() leaks the ingest token secret\noutput head:\n%s", head(out, 240))
	}
}
