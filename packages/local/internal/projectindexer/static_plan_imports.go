package projectindexer

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
)

var projectNativeStaticImportSpecPattern = regexp.MustCompile(
	`(?m)(?:import|export)\s+(?:[^'"` + "`" + `]*?\s+from\s+)?["']([^"']+)["']|require\s*\(\s*["']([^"']+)["']\s*\)`,
)

func projectNativeStaticSupportFiles(primaryFiles []string) []string {
	return projectNativeStaticSupportFilesWithCache(primaryFiles, nil)
}

func projectNativeStaticSupportFilesWithCache(
	primaryFiles []string,
	discoveryCache *projectNativeStaticDiscoveryCache,
) []string {
	selected := map[string]bool{}
	queue := append([]string(nil), primaryFiles...)
	primary := map[string]bool{}
	for _, file := range primaryFiles {
		primary[file] = true
	}
	out := map[string]bool{}
	for len(queue) > 0 {
		batch := make([]string, 0, len(queue))
		for _, file := range queue {
			if selected[file] {
				continue
			}
			selected[file] = true
			batch = append(batch, file)
		}
		queue = queue[:0]
		for _, dependencies := range projectNativeStaticLocalImportFilesBatchWithCache(batch, discoveryCache) {
			for _, dependency := range dependencies {
				if selected[dependency] {
					continue
				}
				queue = append(queue, dependency)
				if !primary[dependency] {
					out[dependency] = true
				}
			}
		}
	}
	files := make([]string, 0, len(out))
	for file := range out {
		files = append(files, file)
	}
	sort.Strings(files)
	return files
}

func projectNativeStaticLocalImportFilesBatch(files []string) [][]string {
	return projectNativeStaticLocalImportFilesBatchWithCache(files, nil)
}

func projectNativeStaticLocalImportFilesBatchWithCache(
	files []string,
	discoveryCache *projectNativeStaticDiscoveryCache,
) [][]string {
	results := make([][]string, len(files))
	if len(files) == 0 {
		return results
	}
	workerCount := runtime.GOMAXPROCS(0)
	if workerCount < 1 {
		workerCount = 1
	}
	if workerCount > len(files) {
		workerCount = len(files)
	}
	if workerCount > 32 {
		workerCount = 32
	}
	jobs := make(chan int)
	var wg sync.WaitGroup
	for index := 0; index < workerCount; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for fileIndex := range jobs {
				results[fileIndex] = projectNativeStaticLocalImportFilesWithCache(files[fileIndex], discoveryCache)
			}
		}()
	}
	for index := range files {
		jobs <- index
	}
	close(jobs)
	wg.Wait()
	return results
}

func projectNativeStaticLocalImportFiles(file string) []string {
	files, _ := projectNativeStaticScanLocalImportFiles(file, "")
	return files
}

func projectNativeStaticLocalImportFilesWithCache(
	file string,
	discoveryCache *projectNativeStaticDiscoveryCache,
) []string {
	fingerprint, fingerprintOK := projectNativeStaticDiscoveryFingerprint(file)
	if cached, ok := discoveryCache.CachedImportsWithFingerprint(file, fingerprint, fingerprintOK); ok {
		return cached
	}
	root := ""
	if discoveryCache != nil {
		root = discoveryCache.root
	}
	files, resolutionChecks := projectNativeStaticScanLocalImportFiles(file, root)
	discoveryCache.StoreImportsWithFingerprint(file, files, resolutionChecks, fingerprint, fingerprintOK)
	return files
}

func projectNativeStaticScanLocalImportFiles(
	file string,
	root string,
) ([]string, []projectNativeStaticDiscoveryPathState) {
	source, err := os.ReadFile(file)
	if err != nil {
		return nil, nil
	}
	matches := projectNativeStaticImportSpecPattern.FindAllStringSubmatch(string(source), -1)
	files := []string{}
	resolutionChecks := []projectNativeStaticDiscoveryPathState{}
	for _, match := range matches {
		specifier := match[1]
		if specifier == "" {
			specifier = match[2]
		}
		if !strings.HasPrefix(specifier, ".") {
			continue
		}
		resolved, checks := projectNativeStaticResolveImportWithChecks(root, filepath.Dir(file), specifier)
		resolutionChecks = append(resolutionChecks, checks...)
		if resolved != "" {
			files = appendUniqueSorted(files, resolved)
		}
	}
	return files, resolutionChecks
}

func projectNativeStaticResolveImport(fromDir string, specifier string) string {
	resolved, _ := projectNativeStaticResolveImportWithChecks("", fromDir, specifier)
	return resolved
}

func projectNativeStaticResolveImportWithChecks(
	root string,
	fromDir string,
	specifier string,
) (string, []projectNativeStaticDiscoveryPathState) {
	base := filepath.Clean(filepath.Join(fromDir, specifier))
	candidates := []string{base}
	if filepath.Ext(base) == "" {
		for _, ext := range []string{".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"} {
			candidates = append(candidates, base+ext)
		}
		for _, ext := range []string{".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"} {
			candidates = append(candidates, filepath.Join(base, "index"+ext))
		}
	}
	checks := make([]projectNativeStaticDiscoveryPathState, 0, len(candidates))
	for _, candidate := range candidates {
		check := projectNativeStaticReadDiscoveryPathState(root, candidate)
		checks = append(checks, check)
		if check.Exists && !check.IsDir && check.SourceFile {
			return candidate, checks
		}
	}
	return "", checks
}

func appendUniqueSorted(values []string, next string) []string {
	if next == "" {
		return values
	}
	index := sort.SearchStrings(values, next)
	if index < len(values) && values[index] == next {
		return values
	}
	values = append(values, "")
	copy(values[index+1:], values[index:])
	values[index] = next
	return values
}

func projectNativeStaticLongestLine(sample string) int {
	longest := 0
	for _, line := range strings.Split(sample, "\n") {
		line = strings.TrimSuffix(line, "\r")
		if len(line) > longest {
			longest = len(line)
		}
	}
	return longest
}

func minInt64(left int64, right int64) int64 {
	if left < right {
		return left
	}
	return right
}
