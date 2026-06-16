package output

import (
	"bytes"
	"strings"
	"testing"
)

func TestHyperlinkLinkable(t *testing.T) {
	io := NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, TestIOOptions{
		StdoutTTY:    true,
		StderrTTY:    true,
		ColorEnabled: true,
	})
	const url = "http://localhost:4400/traces/abc123"
	got := io.Hyperlink("trace abc123", url, true)

	if !strings.Contains(got, "\x1b]8;;") {
		t.Errorf("expected OSC-8 opener in %q", got)
	}
	if !strings.Contains(got, url) {
		t.Errorf("expected url %q in %q", url, got)
	}
	if !strings.Contains(got, "trace abc123") {
		t.Errorf("expected link text in %q", got)
	}
	// Terminator: opener with empty URI followed by ST.
	if !strings.HasSuffix(got, "\x1b]8;;\x1b\\") {
		t.Errorf("expected OSC-8 terminator suffix in %q", got)
	}
}

func TestHyperlinkFallback(t *testing.T) {
	const url = "http://localhost:4400/traces/abc123"
	tests := []struct {
		name string
		io   *IO
		text string
		want string
	}{
		{
			name: "non_tty_keeps_url_with_text",
			io:   NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, TestIOOptions{ColorEnabled: true}),
			text: "trace abc123",
			want: "trace abc123 (" + url + ")",
		},
		{
			name: "tty_but_no_color_falls_back",
			io:   NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, TestIOOptions{StdoutTTY: true, ColorEnabled: false}),
			text: "trace abc123",
			want: "trace abc123 (" + url + ")",
		},
		{
			name: "empty_text_yields_bare_url",
			io:   NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, TestIOOptions{ColorEnabled: true}),
			text: "",
			want: url,
		},
		{
			name: "text_equals_url_yields_bare_url",
			io:   NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, TestIOOptions{ColorEnabled: true}),
			text: url,
			want: url,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.io.Hyperlink(tt.text, url, true)
			if got != tt.want {
				t.Errorf("Hyperlink = %q, want %q", got, tt.want)
			}
			if strings.Contains(got, "\x1b") {
				t.Errorf("fallback emitted an ANSI escape: %q", got)
			}
		})
	}
}

// TestHyperlinkStreamSelection verifies onStdout picks the correct stream's TTY
// status: a stdout-only TTY links stdout links but falls back for stderr links.
func TestHyperlinkStreamSelection(t *testing.T) {
	io := NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, TestIOOptions{
		StdoutTTY:    true,
		StderrTTY:    false,
		ColorEnabled: true,
	})
	const url = "http://x/y"
	if out := io.Hyperlink("t", url, true); !strings.Contains(out, "\x1b]8;;") {
		t.Errorf("stdout link should be emitted on a stdout TTY, got %q", out)
	}
	if errLink := io.Hyperlink("t", url, false); strings.Contains(errLink, "\x1b") {
		t.Errorf("stderr link should fall back when stderr is not a TTY, got %q", errLink)
	}
}
