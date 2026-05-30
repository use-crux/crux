package output

import "testing"

func TestFormatTokens(t *testing.T) {
	tests := []struct {
		name  string
		input int
		want  string
	}{
		{"zero", 0, "0"},
		{"small", 567, "567"},
		{"thousands", 1500, "1.5k"},
		{"exact_thousand", 1000, "1.0k"},
		{"millions", 1500000, "1.5M"},
		{"exact_million", 1000000, "1.0M"},
		{"large", 234567, "234.6k"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := FormatTokens(tt.input); got != tt.want {
				t.Errorf("FormatTokens(%d) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestFormatCost(t *testing.T) {
	tests := []struct {
		name  string
		input float64
		want  string
	}{
		{"zero", 0, "$0.0000"},
		{"small", 0.001, "$0.0010"},
		{"medium", 0.12, "$0.12"},
		{"dollar", 1.50, "$1.50"},
		{"tiny", 0.0042, "$0.0042"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := FormatCost(tt.input); got != tt.want {
				t.Errorf("FormatCost(%f) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestFormatDuration(t *testing.T) {
	tests := []struct {
		name  string
		input float64
		want  string
	}{
		{"subsecond", 500, "0.5s"},
		{"seconds", 5000, "5.0s"},
		{"minutes", 90000, "1.5m"},
		{"exact_minute", 60000, "1.0m"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := FormatDuration(tt.input); got != tt.want {
				t.Errorf("FormatDuration(%f) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestFormatPercent(t *testing.T) {
	tests := []struct {
		name  string
		input float64
		want  string
	}{
		{"zero", 0, "0%"},
		{"half", 0.5, "50%"},
		{"full", 1.0, "100%"},
		{"fraction", 0.93, "93%"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := FormatPercent(tt.input); got != tt.want {
				t.Errorf("FormatPercent(%f) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestTokenBar(t *testing.T) {
	tests := []struct {
		name           string
		used, total, w int
		want           string
	}{
		{"empty", 0, 100, 10, "░░░░░░░░░░"},
		{"full", 100, 100, 10, "██████████"},
		{"half", 50, 100, 10, "█████░░░░░"},
		{"zero_total", 0, 0, 10, ""},
		{"zero_width", 50, 100, 0, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := TokenBar(tt.used, tt.total, tt.w); got != tt.want {
				t.Errorf("TokenBar(%d, %d, %d) = %q, want %q", tt.used, tt.total, tt.w, got, tt.want)
			}
		})
	}
}

func TestMiniBar(t *testing.T) {
	tests := []struct {
		name          string
		value, max, w int
		wantLen       int
	}{
		{"normal", 50, 100, 10, 10},
		{"zero_max", 50, 0, 10, 0},
		{"zero_width", 50, 100, 0, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MiniBar(tt.value, tt.max, tt.w)
			if len([]rune(got)) != tt.wantLen {
				t.Errorf("MiniBar(%d, %d, %d) length = %d, want %d", tt.value, tt.max, tt.w, len([]rune(got)), tt.wantLen)
			}
		})
	}
}

func TestTokenBarSegmented(t *testing.T) {
	segments := []BarSegment{
		{Value: 30, Char: '█'},
		{Value: 20, Char: '▓'},
	}
	got := TokenBarSegmented(segments, 100, 10)
	if len([]rune(got)) != 10 {
		t.Errorf("expected 10 runes, got %d", len([]rune(got)))
	}
	// First 3 should be '█', next 2 '▓', rest '░'.
	runes := []rune(got)
	if runes[0] != '█' {
		t.Errorf("expected first char █, got %c", runes[0])
	}
	if runes[3] != '▓' {
		t.Errorf("expected char at 3 to be ▓, got %c", runes[3])
	}
	if runes[5] != '░' {
		t.Errorf("expected char at 5 to be ░, got %c", runes[5])
	}
}

func TestShortenModel(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"exact_match", "claude-sonnet-4-20250514", "sonnet-4"},
		{"strip_prefix", "anthropic/claude-sonnet-4-20250514", "sonnet-4"},
		{"unknown_short", "my-model", "my-model"},
		{"gpt_match", "gpt-4.1-mini-2025-04-14", "gpt-4.1-mini"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ShortenModel(tt.input); got != tt.want {
				t.Errorf("ShortenModel(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
