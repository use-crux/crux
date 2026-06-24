package server

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strings"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

type projectNativeStaticSourceInput struct {
	Files                 []projectNativeStaticSourceFile
	PrimaryFiles          []projectNativeStaticSourceFile
	SourceTextByFile      map[string]string
	SemanticSourceProfile *devtools.SemanticSourceProfile
}

type projectNativeStaticSourceRead struct {
	file       string
	source     []byte
	sourceHash string
	err        error
}

type projectNativeStaticHostManifest struct {
	NativeOnlyEligible                  bool `json:"nativeOnlyEligible"`
	TypeScriptRuleCount                 int  `json:"typeScriptRuleCount"`
	RequiresTypeScriptHostForBundled    bool `json:"requiresTypeScriptHostForBundled"`
	RequiresTypeScriptHostForRules      bool `json:"requiresTypeScriptHostForRules"`
	RequiresTypeScriptHostForExtensions bool `json:"requiresTypeScriptHostForExtensions"`
	RequiresCompatibilityEvidence       bool `json:"requiresCompatibilityEvidence"`
}

func projectStaticPlanRequiresTypeScriptRules(plan devtools.ProjectStaticSyntaxPlan) bool {
	host, ok := projectStaticPlanNativeStaticHostManifest(plan)
	return ok && (host.RequiresTypeScriptHostForRules || host.TypeScriptRuleCount > 0)
}

func projectNativeStaticSourceInputFromPlan(plan devtools.ProjectStaticSyntaxPlan) (projectNativeStaticSourceInput, error) {
	filesToParse := projectSyntaxPlanFilesToParse(plan)
	cacheEntries := projectNativeStaticSourceInputCacheEntries(plan.CacheEntries)
	primaryFileSet := projectNativeStaticPrimaryFileSet(plan)
	analyzeFileSet := projectNativeStaticAnalyzeFileSet(filesToParse)
	files := projectNativeStaticSourceInputFiles(plan)
	reads := projectNativeStaticReadSourceFiles(projectNativeStaticSourceInputFilesToRead(files, analyzeFileSet, cacheEntries))
	readByFile := projectNativeStaticSourceReadMap(reads)
	input := projectNativeStaticSourceInput{
		Files:            make([]projectNativeStaticSourceFile, 0, len(files)),
		PrimaryFiles:     []projectNativeStaticSourceFile{},
		SourceTextByFile: map[string]string{},
	}
	profileFiles := []devtools.SemanticSourceProfileFile{}
	for _, file := range files {
		cacheEntry := cacheEntries[file]
		read, readOK := readByFile[file]
		if readOK && read.err != nil {
			return projectNativeStaticSourceInput{}, fmt.Errorf("read source for native static prepare %s: %w", read.file, read.err)
		}
		sourceFile := projectNativeStaticSourceFile{
			File:       file,
			SourceHash: cacheEntry.SourceHash,
			CacheKey:   cacheEntry.CacheKey,
		}
		if readOK {
			sourceFile.SourceHash = read.sourceHash
			if profile, ok := projectNativeStaticSemanticSourceProfileFileFromRead(read); ok {
				profileFiles = append(profileFiles, profile)
			}
		} else if profile, ok := projectNativeStaticSourceInputCachedProfile(file, cacheEntry); ok {
			profileFiles = append(profileFiles, profile)
		}
		if sourceFile.SourceHash == "" {
			return projectNativeStaticSourceInput{}, fmt.Errorf("source hash for native static prepare %s was not prepared", file)
		}
		input.Files = append(input.Files, sourceFile)
		if primaryFileSet[file] {
			input.PrimaryFiles = append(input.PrimaryFiles, sourceFile)
		}
		if analyzeFileSet[file] {
			input.SourceTextByFile[file] = string(read.source)
		}
	}
	input.SemanticSourceProfile = projectNativeStaticSemanticSourceProfileFromFiles(profileFiles)
	return input, nil
}

func projectNativeStaticUniqueFiles(files []string) []string {
	selected := make([]string, 0, len(files))
	seen := map[string]bool{}
	for _, file := range files {
		if file == "" || seen[file] {
			continue
		}
		seen[file] = true
		selected = append(selected, file)
	}
	return selected
}

func projectNativeStaticReadSourceFiles(files []string) []projectNativeStaticSourceRead {
	reads := make([]projectNativeStaticSourceRead, len(files))
	if len(files) == 0 {
		return reads
	}
	workerCount := runtime.GOMAXPROCS(0)
	if workerCount < 1 {
		workerCount = 1
	}
	if workerCount > len(files) {
		workerCount = len(files)
	}
	jobs := make(chan int)
	var wg sync.WaitGroup
	for index := 0; index < workerCount; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range jobs {
				reads[index] = projectNativeStaticReadSourceFile(files[index])
			}
		}()
	}
	for index := range files {
		jobs <- index
	}
	close(jobs)
	wg.Wait()
	return reads
}

func projectNativeStaticReadSourceFile(file string) projectNativeStaticSourceRead {
	source, err := os.ReadFile(file)
	if err != nil {
		return projectNativeStaticSourceRead{file: file, err: err}
	}
	sum := sha256.Sum256(source)
	return projectNativeStaticSourceRead{
		file:       file,
		source:     source,
		sourceHash: fmt.Sprintf("%x", sum),
	}
}

func projectNativeStaticAnalyzeFileSet(files []string) map[string]bool {
	selected := make(map[string]bool, len(files))
	for _, file := range files {
		if file != "" {
			selected[file] = true
		}
	}
	return selected
}

func projectNativeStaticPrimaryFileSet(plan devtools.ProjectStaticSyntaxPlan) map[string]bool {
	files := append([]string(nil), plan.CacheHits...)
	files = append(files, plan.CacheMisses...)
	if plan.FilesToParse == nil || len(files) == 0 {
		files = plan.Files
	}
	selected := make(map[string]bool, len(files))
	for _, file := range files {
		if file != "" {
			selected[file] = true
		}
	}
	return selected
}

func projectStaticPlanNativeOnlyEligible(plan devtools.ProjectStaticSyntaxPlan) bool {
	host, ok := projectStaticPlanNativeStaticHostManifest(plan)
	return ok &&
		host.NativeOnlyEligible &&
		!host.RequiresTypeScriptHostForBundled &&
		!host.RequiresTypeScriptHostForExtensions &&
		!host.RequiresTypeScriptHostForRules &&
		!host.RequiresCompatibilityEvidence
}

func projectStaticPlanNativeStaticSchedulable(plan devtools.ProjectStaticSyntaxPlan) bool {
	host, ok := projectStaticPlanNativeStaticHostManifest(plan)
	return ok && !host.RequiresCompatibilityEvidence
}

func projectStaticPlanNativeStaticHostManifest(plan devtools.ProjectStaticSyntaxPlan) (projectNativeStaticHostManifest, bool) {
	raw := strings.TrimSpace(string(plan.StaticHost))
	if raw == "" || raw == "null" {
		return projectNativeStaticHostManifest{}, false
	}
	var host projectNativeStaticHostManifest
	if err := json.Unmarshal(plan.StaticHost, &host); err != nil {
		return projectNativeStaticHostManifest{}, false
	}
	return host, true
}

func projectNativeStaticCacheKeys(entries []devtools.StaticCacheHit) map[string]string {
	if len(entries) == 0 {
		return nil
	}
	keys := make(map[string]string, len(entries))
	for _, entry := range entries {
		if entry.File != "" && entry.CacheKey != "" {
			keys[entry.File] = entry.CacheKey
		}
	}
	return keys
}

func projectNativeStaticAnalyzeFilesWithSourceText(files []projectNativeStaticSourceFile, sourceTextByFile map[string]string) ([]projectNativeStaticAnalyzeFile, error) {
	out := make([]projectNativeStaticAnalyzeFile, 0, len(files))
	for _, file := range files {
		sourceText, ok := sourceTextByFile[file.File]
		if !ok {
			return nil, fmt.Errorf("source text for native static analyze %s was not prepared", file.File)
		}
		out = append(out, projectNativeStaticAnalyzeFile{
			File:       file.File,
			SourceHash: file.SourceHash,
			SourceText: sourceText,
		})
	}
	return out, nil
}

func projectNativeStaticSourceFilesToAnalyze(
	files []projectNativeStaticSourceFile,
	filesToParse []string,
) []projectNativeStaticSourceFile {
	selected := projectNativeStaticAnalyzeFileSet(filesToParse)
	out := make([]projectNativeStaticSourceFile, 0, len(files))
	for _, file := range files {
		if selected[file.File] {
			out = append(out, file)
		}
	}
	return out
}

func projectNativeStaticAnalyzeFiles(files []projectNativeStaticSourceFile) []projectNativeStaticAnalyzeFile {
	out := make([]projectNativeStaticAnalyzeFile, 0, len(files))
	for _, file := range files {
		out = append(out, projectNativeStaticAnalyzeFile{
			File:       file.File,
			SourceHash: file.SourceHash,
		})
	}
	return out
}
