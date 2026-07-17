package evalfs

import (
	"bytes"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var safeEvalID = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)

// ListBaselines returns validated committed Eval Baselines in Eval ID order.
func (s *Store) ListBaselines() ([]json.RawMessage, error) {
	paths, err := s.baselinePaths()
	if err != nil {
		return nil, err
	}
	records := make([]json.RawMessage, 0, len(paths))
	for _, path := range paths {
		baseline, err := readBaseline(path)
		if err != nil {
			return nil, err
		}
		records = append(records, bytes.Clone(baseline.Raw))
	}
	sort.Slice(records, func(i, j int) bool {
		var left, right Baseline
		_ = json.Unmarshal(records[i], &left)
		_ = json.Unmarshal(records[j], &right)
		return left.EvalID < right.EvalID
	})
	return records, nil
}

// ReadBaselineRaw finds one Baseline by its embedded Eval identity.
func (s *Store) ReadBaselineRaw(evalID string) (json.RawMessage, bool, error) {
	if !safeEvalID.MatchString(evalID) {
		return nil, false, errors.New("invalid Eval ID")
	}
	paths, err := s.baselinePaths()
	if err != nil {
		return nil, false, err
	}
	for _, path := range paths {
		baseline, err := readBaseline(path)
		if err != nil {
			return nil, false, err
		}
		if baseline.EvalID == evalID {
			return bytes.Clone(baseline.Raw), true, nil
		}
	}
	return nil, false, nil
}

func (s *Store) baselinePaths() ([]string, error) {
	var paths []string
	err := filepath.WalkDir(s.projectRoot, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() && ignoredEvalDirectory(entry.Name()) && path != s.projectRoot {
			return filepath.SkipDir
		}
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".baseline.json") {
			paths = append(paths, path)
		}
		return nil
	})
	if errors.Is(err, os.ErrNotExist) {
		return []string{}, nil
	}
	sort.Strings(paths)
	return paths, err
}

func readBaseline(path string) (Baseline, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Baseline{}, err
	}
	return ParseBaseline(raw)
}

func ignoredEvalDirectory(name string) bool {
	switch name {
	case ".git", ".crux", ".next", ".turbo", "dist", "node_modules":
		return true
	default:
		return false
	}
}
