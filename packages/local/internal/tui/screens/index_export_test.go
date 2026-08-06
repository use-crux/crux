package screens

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestIndexExportUsesPortableFilenameAndRendersSuccess(t *testing.T) {
	root := t.TempDir()
	definition := api.ProjectDefinition{
		ID:       "prompt:evil\\..\x1b]8;;bad\x07\nname/part",
		Kind:     "prompt",
		Name:     "unsafe export",
		Fidelity: "resolved",
	}
	index := NewIndex()
	index.exportRoot = func() (string, error) { return root, nil }
	index.SetIndexForTest(api.IndexData{Definitions: []api.ProjectDefinition{definition}})
	index.Resize(Size{Width: 100, Height: 24})

	cmd := index.Update(testContext, tea.KeyPressMsg{Text: "x", Code: 'x'}, nil)
	if cmd == nil {
		t.Fatal("export action returned no command")
	}
	index.Update(testContext, cmd(), nil)

	view := stripANSI(index.View(Size{}))
	if !strings.Contains(view, "exported") {
		t.Fatalf("successful export had no visible outcome:\n%s", view)
	}
	entries, err := os.ReadDir(filepath.Join(root, ".crux", "exports"))
	if err != nil {
		t.Fatalf("read export directory: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("export files = %d, want 1", len(entries))
	}
	name := entries[0].Name()
	if !regexp.MustCompile(`^definition-[A-Za-z0-9._-]+-[a-f0-9]{10}\.json$`).MatchString(name) {
		t.Fatalf("non-portable export filename %q", name)
	}
	body, err := os.ReadFile(filepath.Join(root, ".crux", "exports", name))
	if err != nil {
		t.Fatalf("read export: %v", err)
	}
	var decoded api.ProjectDefinition
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	if decoded.ID != definition.ID {
		t.Fatalf("exported definition ID = %q, want exact %q", decoded.ID, definition.ID)
	}
}

func TestIndexExportFailureKeepsDataAndRendersBoundedError(t *testing.T) {
	index := NewIndex()
	index.exportRoot = func() (string, error) {
		return "", errors.New("permission denied " + strings.Repeat("temporarily unavailable ", 20) + "\x1b]8;;https://evil.invalid\x07bad\x1b]8;;\x07")
	}
	index.SetIndexForTest(sampleIndex())
	index.Resize(Size{Width: 100, Height: 24})

	cmd := index.Update(testContext, tea.KeyPressMsg{Text: "x", Code: 'x'}, nil)
	index.Update(testContext, cmd(), nil)
	view := index.View(Size{})
	plain := stripANSI(view)
	for _, want := range []string{"export failed", "permission denied", "writer.prompt"} {
		if !strings.Contains(plain, want) {
			t.Fatalf("export failure omitted %q or last-good Index data:\n%s", want, plain)
		}
	}
	if strings.Contains(view, "https://evil.invalid") {
		t.Fatalf("export error rendered terminal control payload:\n%q", view)
	}
	for lineIndex, line := range strings.Split(view, "\n") {
		if width := lipgloss.Width(line); width != 100 {
			t.Fatalf("export failure line %d width = %d, want 100", lineIndex+1, width)
		}
	}
}

func TestIndexLateExportOutcomeDoesNotAttachToAnotherDefinition(t *testing.T) {
	index := NewIndex()
	index.exportRoot = func() (string, error) { return t.TempDir(), nil }
	index.SetIndexForTest(api.IndexData{Definitions: []api.ProjectDefinition{
		{ID: "prompt:a", Kind: "prompt", Name: "definition a"},
		{ID: "prompt:b", Kind: "prompt", Name: "definition b"},
	}})
	index.Resize(Size{Width: 100, Height: 24})

	exportA := index.Update(testContext, tea.KeyPressMsg{Text: "x", Code: 'x'}, nil)
	index.definitions.Select("prompt:b")
	index.syncDetail()
	index.Update(testContext, exportA(), nil)

	view := stripANSI(index.View(Size{}))
	if strings.Contains(view, "exported") || strings.Contains(view, "export failed") {
		t.Fatalf("late definition A export outcome leaked into definition B:\n%s", view)
	}
}
