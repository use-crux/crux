package cache

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

const Epoch = "static-parse-v68"

type Status struct {
	CacheHits    []string
	CacheMisses  []string
	CacheEntries []projectindex.StaticCacheHit
}

type manifestEntry struct {
	Version        string             `json:"version"`
	Root           string             `json:"root"`
	File           string             `json:"file"`
	SourceHash     string             `json:"sourceHash"`
	Dependencies   []sourceHashRecord `json:"dependencies"`
	ConfigFiles    []sourceHashRecord `json:"configFiles"`
	CompilerInputs []json.RawMessage  `json:"compilerInputs"`
	CacheKey       string             `json:"cacheKey"`
}

type sourceHashRecord struct {
	File       string `json:"file"`
	SourceHash string `json:"sourceHash"`
}

func ManifestStatus(
	root string,
	files []string,
	compilerInputs []json.RawMessage,
) Status {
	wantedIdentities := manifestIdentities(root, files, compilerInputs)
	entries := readManifestEntries(root, wantedIdentities)
	configFiles := readConfigFileHashes(root)
	sourceHashes := newSourceHashMemo()
	statuses := manifestFileStatuses(root, files, compilerInputs, configFiles, entries, sourceHashes)
	status := Status{
		CacheHits:    []string{},
		CacheMisses:  []string{},
		CacheEntries: []projectindex.StaticCacheHit{},
	}
	for _, fileStatus := range statuses {
		if !fileStatus.Hit {
			status.CacheMisses = append(status.CacheMisses, fileStatus.File)
			continue
		}
		status.CacheHits = append(status.CacheHits, fileStatus.File)
		status.CacheEntries = append(status.CacheEntries, projectindex.StaticCacheHit{
			File:            fileStatus.File,
			CacheKey:        fileStatus.Entry.CacheKey,
			SourceHash:      fileStatus.Entry.SourceHash,
			SemanticProfile: fileStatus.Extraction.SemanticProfile,
		})
	}
	return status
}

type manifestHitInput struct {
	Root           string
	File           string
	CompilerInputs []json.RawMessage
	ConfigFiles    []sourceHashRecord
	Entries        map[string]manifestEntry
	SourceHashes   *sourceHashMemo
}

func manifestHit(
	input manifestHitInput,
) (manifestEntry, Extraction, bool) {
	identity := manifestIdentity(input.Root, input.File, input.CompilerInputs)
	entry, ok := input.Entries[identity]
	if !ok {
		return manifestEntry{}, Extraction{}, false
	}
	sourceHash, ok := input.SourceHashes.Read(input.File)
	if !ok || entry.SourceHash != sourceHash {
		return manifestEntry{}, Extraction{}, false
	}
	if !sourceHashesEqual(entry.ConfigFiles, input.ConfigFiles) {
		return manifestEntry{}, Extraction{}, false
	}
	for _, dependency := range entry.Dependencies {
		hash, ok := input.SourceHashes.Read(filepath.Join(input.Root, filepath.FromSlash(dependency.File)))
		if !ok || dependency.SourceHash != hash {
			return manifestEntry{}, Extraction{}, false
		}
	}
	extraction, err := ReadExtraction(input.Root, entry.CacheKey)
	if err != nil {
		return manifestEntry{}, Extraction{}, false
	}
	if !extractionMatchesManifest(input.File, entry.SourceHash, extraction) {
		return manifestEntry{}, Extraction{}, false
	}
	return entry, extraction, true
}

func readManifestEntries(
	root string,
	wantedIdentities map[string]bool,
) map[string]manifestEntry {
	entries := map[string]manifestEntry{}
	data, err := os.ReadFile(manifestLogFile(root))
	if err != nil {
		return entries
	}
	lines := strings.Split(string(data), "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		line := lines[index]
		if strings.TrimSpace(line) == "" {
			continue
		}
		var entry manifestEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil || !validManifestEntry(root, entry) {
			continue
		}
		identity := manifestIdentity(root, entry.File, entry.CompilerInputs)
		if !wantedIdentities[identity] {
			continue
		}
		if _, exists := entries[identity]; exists {
			continue
		}
		entries[identity] = entry
		if len(entries) == len(wantedIdentities) {
			break
		}
	}
	return entries
}

func manifestIdentities(
	root string,
	files []string,
	compilerInputs []json.RawMessage,
) map[string]bool {
	identities := make(map[string]bool, len(files))
	for _, file := range files {
		identities[manifestIdentity(root, file, compilerInputs)] = true
	}
	return identities
}

func validManifestEntry(root string, entry manifestEntry) bool {
	return entry.Version == Epoch &&
		entry.Root == root &&
		entry.File != "" &&
		entry.SourceHash != "" &&
		entry.CacheKey != "" &&
		entry.Dependencies != nil &&
		entry.ConfigFiles != nil &&
		entry.CompilerInputs != nil
}

func manifestLogFile(root string) string {
	return filepath.Join(root, ".crux", "cache", "index", Epoch, "manifest.jsonl")
}

func manifestIdentity(root string, file string, compilerInputs []json.RawMessage) string {
	relativeFile := filepath.ToSlash(file)
	if strings.HasPrefix(file, root) {
		if relative, err := filepath.Rel(root, file); err == nil {
			relativeFile = filepath.ToSlash(relative)
		}
	}
	data, _ := json.Marshal(struct {
		Version        string            `json:"version"`
		Root           string            `json:"root"`
		File           string            `json:"file"`
		CompilerInputs []json.RawMessage `json:"compilerInputs"`
	}{
		Version:        Epoch,
		Root:           root,
		File:           relativeFile,
		CompilerInputs: compilerInputs,
	})
	return string(data)
}

func readConfigFileHashes(root string) []sourceHashRecord {
	out := []sourceHashRecord{}
	for _, name := range []string{"jsconfig.json", "tsconfig.json"} {
		if hash, ok := sourceHash(filepath.Join(root, name), nil); ok {
			out = append(out, sourceHashRecord{File: name, SourceHash: hash})
		}
	}
	return out
}

func sourceHash(file string, memo map[string]string) (string, bool) {
	if memo != nil {
		if hash, ok := memo[file]; ok {
			return hash, true
		}
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return "", false
	}
	sum := sha256.Sum256(data)
	hash := fmt.Sprintf("%x", sum)
	if memo != nil {
		memo[file] = hash
	}
	return hash, true
}

func sourceHashesEqual(left, right []sourceHashRecord) bool {
	left = append([]sourceHashRecord(nil), left...)
	right = append([]sourceHashRecord(nil), right...)
	sort.Slice(left, func(i, j int) bool { return left[i].File < left[j].File })
	sort.Slice(right, func(i, j int) bool { return right[i].File < right[j].File })
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func FileForIdentity(root string, cacheKey string) string {
	cacheKeyJSON, _ := json.Marshal(cacheKey)
	sum := sha256.Sum256(cacheKeyJSON)
	return filepath.Join(root, ".crux", "cache", "index", Epoch, fmt.Sprintf("%x.json", sum))
}

func FilesToParse(cacheMisses, files, primaryFiles []string) []string {
	if len(cacheMisses) == 0 {
		return []string{}
	}
	primary := make(map[string]bool, len(primaryFiles))
	for _, file := range primaryFiles {
		primary[file] = true
	}
	selected := map[string]bool{}
	for _, file := range cacheMisses {
		if file != "" {
			selected[file] = true
		}
	}
	for _, file := range files {
		if file != "" && !primary[file] {
			selected[file] = true
		}
	}
	out := make([]string, 0, len(selected))
	for file := range selected {
		out = append(out, file)
	}
	sort.Strings(out)
	return out
}
