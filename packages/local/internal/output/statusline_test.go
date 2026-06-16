package output

import (
	"bytes"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

func TestStatusLineTTYRedraw(t *testing.T) {
	var out, err bytes.Buffer
	io := NewTestIO(&out, &err, TestIOOptions{StderrTTY: true, Width: 80})
	sl := io.NewStatusLine()

	if !sl.Active() {
		t.Fatal("Active() = false on a stderr TTY, want true")
	}

	sl.Set("abc")
	got := err.String()
	if !strings.HasPrefix(got, "\r") {
		t.Errorf("Set should start with carriage return, got %q", got)
	}
	if !strings.Contains(got, "\x1b[K") {
		t.Errorf("Set should clear to end of line, got %q", got)
	}
	if !strings.HasSuffix(got, "abc") {
		t.Errorf("Set should end with the text, got %q", got)
	}
	if strings.Contains(got, "\n") {
		t.Errorf("Set must not emit a newline, got %q", got)
	}

	err.Reset()
	sl.Clear()
	cleared := err.String()
	if cleared != eraseLine {
		t.Errorf("Clear() = %q, want %q", cleared, eraseLine)
	}

	// Progress is diagnostic output: nothing should land on the primary stream.
	if out.Len() != 0 {
		t.Errorf("status line wrote to Out: %q", out.String())
	}
}

func TestStatusLineNonTTYNoOp(t *testing.T) {
	var out, err bytes.Buffer
	io := NewTestIO(&out, &err, TestIOOptions{StderrTTY: false})
	sl := io.NewStatusLine()

	if sl.Active() {
		t.Error("Active() = true on a non-TTY, want false")
	}
	sl.Set("abc")
	sl.Clear()
	if err.Len() != 0 {
		t.Errorf("non-TTY status line wrote to Err: %q", err.String())
	}
}

func TestStatusLineTruncatesToWidth(t *testing.T) {
	var out, err bytes.Buffer
	io := NewTestIO(&out, &err, TestIOOptions{StderrTTY: true, Width: 50})
	sl := io.NewStatusLine()

	sl.Set(strings.Repeat("a", 100))
	got := strings.TrimPrefix(err.String(), eraseLine)
	if w := ansi.StringWidth(got); w > io.Width()-1 {
		t.Errorf("rendered text width = %d, want <= %d", w, io.Width()-1)
	}
}
