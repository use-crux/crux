package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
)

var cruxTestBinary struct {
	once      sync.Once
	directory string
	path      string
	output    []byte
	err       error
}

func TestMain(m *testing.M) {
	code := m.Run()
	if cruxTestBinary.directory != "" {
		_ = os.RemoveAll(cruxTestBinary.directory)
	}
	os.Exit(code)
}

func buildCruxTestBinary(t testing.TB) string {
	t.Helper()

	cruxTestBinary.once.Do(func() {
		cruxTestBinary.directory, cruxTestBinary.err = os.MkdirTemp("", "crux-pty-test-")
		if cruxTestBinary.err != nil {
			return
		}
		cruxTestBinary.path = filepath.Join(cruxTestBinary.directory, "crux")
		command := exec.CommandContext(t.Context(), "go", "build", "-o", cruxTestBinary.path, ".")
		cruxTestBinary.output, cruxTestBinary.err = command.CombinedOutput()
	})
	if cruxTestBinary.err != nil {
		t.Fatalf("build crux test binary: %v\n%s", cruxTestBinary.err, cruxTestBinary.output)
	}
	return cruxTestBinary.path
}
