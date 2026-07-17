// Package legacymigration archives pre-Eval Quality records without making
// them eligible for V3 planning or Baseline comparison.
package legacymigration

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const migrationVersion = 1

// ArchiveExperiments atomically moves the complete V2 experiment directory
// behind a read-only legacy boundary. Repeated calls complete a missing marker
// and never touch cassettes or V3 run/evidence storage.
func ArchiveExperiments(inspectDir string) error {
	source := filepath.Join(inspectDir, "experiments")
	legacyDir := filepath.Join(inspectDir, "legacy")
	destination := filepath.Join(legacyDir, "experiments-v2")
	sourceExists, err := exists(source)
	if err != nil {
		return err
	}
	destinationExists, err := exists(destination)
	if err != nil {
		return err
	}
	if sourceExists && destinationExists {
		return fmt.Errorf("legacy migration conflict: both %s and %s exist", source, destination)
	}
	if sourceExists {
		if err := os.MkdirAll(legacyDir, 0o755); err != nil {
			return err
		}
		if err := os.Rename(source, destination); err != nil {
			return fmt.Errorf("archive V2 experiments: %w", err)
		}
		if err := syncDirectory(legacyDir); err != nil {
			return err
		}
	}
	return writeMarker(legacyDir, destinationExists || sourceExists)
}

func writeMarker(legacyDir string, archived bool) error {
	if err := os.MkdirAll(legacyDir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(struct {
		SchemaVersion int  `json:"schemaVersion"`
		Archived      bool `json:"experimentsV2Archived"`
	}{SchemaVersion: migrationVersion, Archived: archived}, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(legacyDir, "migration-v1.json.tmp-*")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if _, err := temporary.Write(append(data, '\n')); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(name, filepath.Join(legacyDir, "migration-v1.json")); err != nil {
		return err
	}
	return syncDirectory(legacyDir)
}

func exists(path string) (bool, error) {
	_, err := os.Stat(path)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return false, err
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
