package kit

import (
	"strings"
	"testing"

	"github.com/charmbracelet/colorprofile"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/theme"
)

func TestHighlightCodeUsesFixedTokenPalette(t *testing.T) {
	source := `const answer = fn("ok", 42) // note`
	got := HighlightCode(source, "TypeScript", adapterStyles)
	if plain := ansi.Strip(got); plain != source {
		t.Fatalf("highlight changed source: got %q, want %q", plain, source)
	}
	for name, sequence := range map[string]string{
		"keyword":    "38;2;180;142;173",
		"identifier": "38;2;95;227;200",
		"string":     "38;2;126;231;135",
		"number":     "38;2;227;179;65",
		"comment":    "38;2;109;120;114",
	} {
		if !strings.Contains(got, sequence) {
			t.Errorf("highlighted TypeScript has no %s tone (%s): %q", name, sequence, got)
		}
	}
}

func TestHighlightCodeUsesResolvedColorProfile(t *testing.T) {
	styles := theme.NewStyles(theme.Resolve(colorprofile.ANSI256))
	got := HighlightCode(`const answer = "ok"`, "TypeScript", styles)
	if strings.Contains(got, "38;2;") {
		t.Fatalf("ANSI256 highlighting emitted truecolor: %q", got)
	}
	for _, sequence := range []string{"38;5;139", "38;5;86", "38;5;114"} {
		if !strings.Contains(got, sequence) {
			t.Fatalf("ANSI256 highlighting omitted %s: %q", sequence, got)
		}
	}
}

func TestHighlightJSONUsesAccentKeys(t *testing.T) {
	source := `{"key":"value","count":2}`
	got := HighlightCode(source, "json", adapterStyles)
	if plain := ansi.Strip(got); plain != source {
		t.Fatalf("highlight changed JSON: got %q, want %q", plain, source)
	}
	if !strings.Contains(got, "38;2;95;227;200") {
		t.Fatalf("highlighted JSON has no accented key: %q", got)
	}
}
