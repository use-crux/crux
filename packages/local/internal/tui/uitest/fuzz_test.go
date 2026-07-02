package uitest

import "testing"

func TestTruncatedPaneHeaderDetection(t *testing.T) {
	tests := []struct {
		name  string
		lines []string
		want  bool
	}{
		{name: "first line pane header", lines: []string{"Runs…", "body"}, want: true},
		{name: "box title pane header", lines: []string{"╭ Runs… ─╮", "body"}, want: true},
		{name: "body truncation allowed", lines: []string{"Runs", "body…"}, want: false},
		{name: "plain header", lines: []string{"Runs", "body"}, want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := hasTruncatedPaneHeader(tt.lines); got != tt.want {
				t.Fatalf("hasTruncatedPaneHeader(%q) = %v, want %v", tt.lines, got, tt.want)
			}
		})
	}
}
