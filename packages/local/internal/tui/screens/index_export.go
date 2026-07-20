package screens

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	tea "charm.land/bubbletea/v2"
)

type definitionExportedMsg struct {
	defID    string
	filename string
	err      error
}

type indexExportState struct {
	definitionID string
	message      string
}

func defaultIndexExportRoot() (string, error) { return os.UserHomeDir() }

func (s *Index) currentExportState() string {
	if s.exportState.definitionID != s.SelectedDefinitionID() {
		return ""
	}
	return s.exportState.message
}

// exportDefinition writes the focused definition to
// ~/.crux/exports/definition-{id}.json.
func (s *Index) exportDefinition() tea.Cmd {
	definition, _, ok := s.definitions.Selected()
	if !ok {
		return nil
	}
	return func() tea.Msg {
		home, err := s.exportRoot()
		if err != nil {
			return definitionExportedMsg{defID: definition.ID, err: err}
		}
		dir := filepath.Join(home, ".crux", "exports")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return definitionExportedMsg{defID: definition.ID, err: err}
		}
		filename := definitionExportFilename(definition.ID)
		path := filepath.Join(dir, filename)
		body, err := json.MarshalIndent(definition, "", "  ")
		if err != nil {
			return definitionExportedMsg{defID: definition.ID, err: err}
		}
		if err := os.WriteFile(path, body, 0o644); err != nil {
			return definitionExportedMsg{defID: definition.ID, err: err}
		}
		return definitionExportedMsg{defID: definition.ID, filename: filename}
	}
}

func definitionExportFilename(id string) string {
	var safe strings.Builder
	lastSeparator := false
	for _, char := range id {
		allowed := char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '.' || char == '_' || char == '-'
		if allowed {
			safe.WriteRune(char)
			lastSeparator = false
		} else if !lastSeparator {
			safe.WriteByte('-')
			lastSeparator = true
		}
		if safe.Len() >= 40 {
			break
		}
	}
	base := strings.Trim(safe.String(), "-._")
	if base == "" {
		base = "definition"
	}
	digest := sha256.Sum256([]byte(id))
	return fmt.Sprintf("definition-%s-%x.json", base, digest[:5])
}
