package output

import (
	"bytes"
	"strings"
	"testing"
)

func forceColorProfile(t *testing.T) {
	t.Helper()
}

func TestIOStatusColorless(t *testing.T) {
	io := NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, TestIOOptions{ColorEnabled: false})
	got := io.Status("success")
	if got != "✓" {
		t.Errorf("Status(success) with color off = %q, want %q", got, "✓")
	}
	if strings.Contains(got, "\x1b") {
		t.Errorf("Status with color off emitted an ANSI escape: %q", got)
	}
}

func TestIOStatusColored(t *testing.T) {
	forceColorProfile(t)
	io := NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, TestIOOptions{ColorEnabled: true})
	got := io.Status("error")
	if !strings.Contains(got, "✗") {
		t.Errorf("Status(error) = %q, want it to contain the ✗ glyph", got)
	}
	if !strings.Contains(got, "\x1b[") {
		t.Errorf("Status(error) with color on should carry an ANSI escape, got %q", got)
	}
}

// TestStatusGlyphMapping pins the plain glyph for each status key so the split
// of the package-level Status into glyph + style stays faithful.
func TestStatusGlyphMapping(t *testing.T) {
	cases := map[string]string{
		"success":   "✓",
		"completed": "✓",
		"error":     "✗",
		"failed":    "✗",
		"running":   "●",
		"suspended": "⏸",
		"cancelled": "⊘",
		"expired":   "⏱",
		"unknown":   "?",
	}
	for key, want := range cases {
		if got := statusGlyph(key); got != want {
			t.Errorf("statusGlyph(%q) = %q, want %q", key, got, want)
		}
	}
}
