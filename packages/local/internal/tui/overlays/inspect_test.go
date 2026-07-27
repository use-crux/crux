package overlays

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

func TestInspectViewSafelyProjectsUntrustedMetadataAndMalformedPayload(t *testing.T) {
	hostile := "\x1b]8;;https://evil.invalid\x07visible\x1b]8;;\x07\x00" + strings.Repeat("界", 80)
	raw := json.RawMessage("malformed " + hostile)
	inspect := NewInspect()
	inspect.Open(hostile, hostile, raw)

	if inspect.body != string(raw) {
		t.Fatalf("inspect storage changed malformed payload:\n got %q\nwant %q", inspect.body, raw)
	}
	view := inspect.View(70, 24)
	if !utf8.ValidString(view) {
		t.Fatalf("inspect view split multibyte text: %q", view)
	}
	if strings.Contains(view, "\x1b]") || strings.Contains(view, "\x00") {
		t.Fatalf("inspect view retained authored terminal controls: %q", view)
	}
	plain := ansi.Strip(view)
	if !strings.Contains(plain, "visible") || strings.Count(plain, "界") < 80 {
		t.Fatalf("inspect view lost safely wrapped text:\n%s", plain)
	}
	for index, line := range strings.Split(plain, "\n") {
		if width := lipgloss.Width(line); width > 60 {
			t.Fatalf("inspect line %d width = %d, want at most 60: %q", index+1, width, line)
		}
	}
}

func TestInspectViewWrapsWideValidJSONByTerminalCells(t *testing.T) {
	payload, err := json.Marshal(map[string]string{"result": strings.Repeat("界", 100)})
	if err != nil {
		t.Fatal(err)
	}
	inspect := NewInspect()
	inspect.Open("wide result", "tool", payload)

	view := inspect.View(70, 24)
	if !utf8.ValidString(view) {
		t.Fatalf("inspect view split valid multibyte JSON: %q", view)
	}
	plain := ansi.Strip(view)
	if strings.Count(plain, "界") != 100 {
		t.Fatalf("inspect view did not preserve wrapped text:\n%s", plain)
	}
	for index, line := range strings.Split(plain, "\n") {
		if width := lipgloss.Width(line); width > 60 {
			t.Fatalf("inspect line %d width = %d, want at most 60: %q", index+1, width, line)
		}
	}
}
