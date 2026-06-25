package workerproc

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
)

// FindNodePath locates a Node.js binary that can run embedded workers.
func FindNodePath() (string, error) {
	candidates := CandidateNodePaths()
	for _, candidate := range candidates {
		if NodeMajorVersion(candidate) >= 24 {
			return candidate, nil
		}
	}
	if len(candidates) > 0 {
		return "", fmt.Errorf("Node.js >= 24 not found; first candidate %s is %s", candidates[0], NodeVersion(candidates[0]))
	}
	return "", fmt.Errorf("Node.js >= 24 not found in PATH or nvm installs")
}

// CandidateNodePaths returns Node.js binaries in the order workerproc should
// consider them for embedded script execution.
func CandidateNodePaths() []string {
	var candidates []string
	seen := map[string]struct{}{}
	add := func(path string) {
		if path == "" {
			return
		}
		resolved, err := exec.LookPath(path)
		if err != nil {
			if _, statErr := os.Stat(path); statErr != nil {
				return
			}
			resolved = path
		}
		if _, ok := seen[resolved]; ok {
			return
		}
		seen[resolved] = struct{}{}
		candidates = append(candidates, resolved)
	}

	add(os.Getenv("CRUX_NODE_PATH"))
	add(filepath.Join(os.Getenv("NVM_BIN"), "node"))
	add("node")

	if runtime.GOOS == "windows" {
		add(filepath.Join(os.Getenv("ProgramFiles"), "nodejs", "node.exe"))
		add(filepath.Join(os.Getenv("LOCALAPPDATA"), "fnm_multishells", "node.exe"))
	}

	if home, err := os.UserHomeDir(); err == nil {
		nvmRoot := filepath.Join(home, ".nvm", "versions", "node")
		if entries, err := os.ReadDir(nvmRoot); err == nil {
			var versions []string
			for _, entry := range entries {
				if entry.IsDir() {
					versions = append(versions, entry.Name())
				}
			}
			sort.Slice(versions, func(i, j int) bool {
				return compareNodeVersionDirs(versions[i], versions[j]) > 0
			})
			for _, version := range versions {
				add(filepath.Join(nvmRoot, version, "bin", "node"))
			}
		}
	}

	return candidates
}

// NodeMajorVersion returns the parsed major version for a Node.js binary.
func NodeMajorVersion(path string) int {
	version := NodeVersion(path)
	version = strings.TrimPrefix(strings.TrimSpace(version), "v")
	major, _, _ := strings.Cut(version, ".")
	value, err := strconv.Atoi(major)
	if err != nil {
		return 0
	}
	return value
}

// NodeVersion returns the raw --version output for a Node.js binary.
func NodeVersion(path string) string {
	output, err := exec.Command(path, "--version").Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(output))
}

func compareNodeVersionDirs(a, b string) int {
	partsA := nodeVersionParts(a)
	partsB := nodeVersionParts(b)
	for i := 0; i < len(partsA) && i < len(partsB); i++ {
		if partsA[i] > partsB[i] {
			return 1
		}
		if partsA[i] < partsB[i] {
			return -1
		}
	}
	return 0
}

func nodeVersionParts(version string) [3]int {
	version = strings.TrimPrefix(version, "v")
	parts := strings.Split(version, ".")
	var parsed [3]int
	for i := 0; i < len(parts) && i < len(parsed); i++ {
		value, err := strconv.Atoi(parts[i])
		if err == nil {
			parsed[i] = value
		}
	}
	return parsed
}
