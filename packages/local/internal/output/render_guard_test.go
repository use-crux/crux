package output

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCommandCodeDoesNotCallRenderDirectly(t *testing.T) {
	commandsDir := filepath.Clean("../commands")
	var offenders []string

	err := filepath.WalkDir(commandsDir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for lineNo, line := range strings.Split(string(data), "\n") {
			if strings.Contains(line, ".Render(") {
				offenders = append(offenders, fmt.Sprintf("%s:%d: %s", filepath.ToSlash(path), lineNo+1, strings.TrimSpace(line)))
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(offenders) > 0 {
		t.Fatalf("command code must render through output.IO helpers, not direct .Render calls:\n%s", strings.Join(offenders, "\n"))
	}
}
