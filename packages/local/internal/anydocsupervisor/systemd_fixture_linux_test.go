//go:build linux

package anydocsupervisor

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

const (
	systemdFixtureEnv    = "CRUX_SYSTEMD_FIXTURE_PATH"
	systemdFixtureBytes  = 6499
	systemdFixtureSHA256 = "5766439b78597e77a28ebf41562ed2375edff1cf6de84eea22590ab73ce1a9fd"
)

// loadSystemdFixture deliberately accepts an explicit absolute path so a
// compiled test binary has no dependency on its current working directory.
func loadSystemdFixture(path string) ([]byte, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, errors.New("invalid systemd fixture path")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() != systemdFixtureBytes {
		return nil, errors.New("invalid systemd fixture")
	}
	bytes, err := os.ReadFile(path)
	if err != nil || len(bytes) != systemdFixtureBytes {
		return nil, errors.New("invalid systemd fixture")
	}
	sum := sha256.Sum256(bytes)
	if hex.EncodeToString(sum[:]) != systemdFixtureSHA256 {
		return nil, errors.New("invalid systemd fixture")
	}
	return bytes, nil
}

func TestSystemdFixturePathIsCWDIndependent(t *testing.T) {
	if _, err := loadSystemdFixture("fixtures/prose.docx"); err == nil {
		t.Fatal("relative fixture path accepted")
	}
	path := filepath.Join(t.TempDir(), "prose.docx")
	if err := os.WriteFile(path, []byte("not the canonical fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadSystemdFixture(path); err == nil {
		t.Fatal("unattested fixture accepted")
	}
}
