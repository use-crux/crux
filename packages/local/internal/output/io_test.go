package output

import (
	"bytes"
	"strings"
	"testing"
)

// clearColorEnv neutralizes every environment variable that colorEnabledFor /
// forceTTY consult, so each matrix row starts from a known baseline regardless
// of the host shell. t.Setenv restores them after the test.
func clearColorEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{"NO_COLOR", "TERM", "CLICOLOR_FORCE", "CRUX_FORCE_TTY"} {
		t.Setenv(k, "")
	}
}

func TestColorEnabledMatrix(t *testing.T) {
	tests := []struct {
		name          string
		noColor       bool
		streamTTY     bool
		noColorEnv    string
		term          string
		clicolorForce string
		cruxForceTTY  string
		want          bool
	}{
		{name: "tty_no_optouts", streamTTY: true, want: true},
		{name: "non_tty_plain", streamTTY: false, want: false},
		{name: "no_color_flag_overrides_tty", noColor: true, streamTTY: true, want: false},
		{name: "no_color_env_overrides_tty", streamTTY: true, noColorEnv: "1", want: false},
		{name: "term_dumb_disables", streamTTY: true, term: "dumb", want: false},
		{name: "clicolor_force_on_non_tty", streamTTY: false, clicolorForce: "1", want: true},
		{name: "clicolor_force_zero_is_off", streamTTY: false, clicolorForce: "0", want: false},
		{name: "crux_force_tty_on_non_tty", streamTTY: false, cruxForceTTY: "1", want: true},
		{name: "no_color_beats_force", streamTTY: false, noColorEnv: "1", clicolorForce: "1", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clearColorEnv(t)
			t.Setenv("NO_COLOR", tt.noColorEnv)
			t.Setenv("TERM", tt.term)
			t.Setenv("CLICOLOR_FORCE", tt.clicolorForce)
			t.Setenv("CRUX_FORCE_TTY", tt.cruxForceTTY)
			if got := colorEnabledFor(tt.noColor, tt.streamTTY); got != tt.want {
				t.Errorf("colorEnabledFor(noColor=%v, streamTTY=%v) = %v, want %v",
					tt.noColor, tt.streamTTY, got, tt.want)
			}
		})
	}
}

func TestSprintColorlessInvariant(t *testing.T) {
	io := NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, TestIOOptions{ColorEnabled: false})
	got := io.Sprint(Red, "x")
	if got != "x" {
		t.Errorf("Sprint with color disabled = %q, want %q", got, "x")
	}
	if strings.Contains(got, "\x1b") {
		t.Errorf("Sprint with color disabled emitted an ANSI escape: %q", got)
	}
}

func TestDetectCI(t *testing.T) {
	vars := []string{"CI", "GITHUB_ACTIONS", "BUILDKITE", "GITLAB_CI", "CIRCLECI", "TEAMCITY_VERSION"}
	for _, k := range vars {
		t.Run("set_"+k, func(t *testing.T) {
			for _, other := range vars {
				t.Setenv(other, "")
			}
			t.Setenv(k, "true")
			if !detectCI() {
				t.Errorf("detectCI() = false with %s set, want true", k)
			}
		})
	}
	t.Run("none_set", func(t *testing.T) {
		for _, k := range vars {
			t.Setenv(k, "")
		}
		if detectCI() {
			t.Error("detectCI() = true with no CI env set, want false")
		}
	})
	t.Run("ci_false_is_off", func(t *testing.T) {
		for _, k := range vars {
			t.Setenv(k, "")
		}
		t.Setenv("CI", "false")
		if detectCI() {
			t.Error("detectCI() = true with CI=false, want false")
		}
	})
}

func TestWidthClamp(t *testing.T) {
	tests := []struct {
		name  string
		width int
		want  int
	}{
		{"default_when_zero", 0, 80},
		{"clamped_low", 10, 40},
		{"clamped_high", 500, 200},
		{"in_range", 120, 120},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			io := NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, TestIOOptions{Width: tt.width})
			if got := io.Width(); got != tt.want {
				t.Errorf("Width() with opt %d = %d, want %d", tt.width, got, tt.want)
			}
		})
	}
}

func TestTestIOAccessors(t *testing.T) {
	io := NewTestIO(&bytes.Buffer{}, &bytes.Buffer{}, TestIOOptions{
		StdoutTTY:    true,
		StderrTTY:    false,
		ColorEnabled: true,
		CI:           true,
	})
	if !io.IsStdoutTTY() {
		t.Error("IsStdoutTTY() = false, want true")
	}
	if io.IsStderrTTY() {
		t.Error("IsStderrTTY() = true, want false")
	}
	if !io.ColorEnabled() {
		t.Error("ColorEnabled() = false, want true")
	}
	if !io.IsCI() {
		t.Error("IsCI() = false, want true")
	}
}
