package commands

import "testing"

func TestSelectDevModeRequiresAnInteractiveTerminal(t *testing.T) {
	tests := []struct {
		name string
		in   devModeInput
		want devMode
	}{
		{
			name: "capable terminal",
			in:   devModeInput{StdinTTY: true, StdoutTTY: true, Term: "xterm-256color"},
			want: devModeTUI,
		},
		{
			name: "redirected stdin",
			in:   devModeInput{StdoutTTY: true, Term: "xterm-256color"},
			want: devModePlain,
		},
		{
			name: "redirected stdout",
			in:   devModeInput{StdinTTY: true, Term: "xterm-256color"},
			want: devModePlain,
		},
		{
			name: "CI",
			in:   devModeInput{StdinTTY: true, StdoutTTY: true, CI: true, Term: "xterm-256color"},
			want: devModePlain,
		},
		{
			name: "dumb terminal",
			in:   devModeInput{StdinTTY: true, StdoutTTY: true, Term: "dumb"},
			want: devModePlain,
		},
		{
			name: "explicit no TUI",
			in:   devModeInput{NoTUI: true, StdinTTY: true, StdoutTTY: true, Term: "xterm-256color"},
			want: devModePlain,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := selectDevMode(test.in); got != test.want {
				t.Fatalf("selectDevMode(%+v) = %q, want %q", test.in, got, test.want)
			}
		})
	}
}
