package staticsource

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strings"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
)

type Input struct {
	Files                 []staticprotocol.SourceFile
	PrimaryFiles          []staticprotocol.SourceFile
	SourceTextByFile      map[string]string
	SemanticSourceProfile *devtools.SemanticSourceProfile
}

type sourceRead struct {
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

func InputFromPlan(plan devtools.ProjectStaticSyntaxPlan) (Input, error) {
	filesToParse := projectSyntaxPlanFilesToParse(plan)
	cacheEntries := cacheEntries(plan.CacheEntries)
	primaryFileSet := primaryFileSet(plan)
	analyzeFileSet := analyzeFileSet(filesToParse)
	files := inputFiles(plan)
	reads := readFiles(filesToRead(files, analyzeFileSet, cacheEntries))
	readByFile := readMap(reads)
	input := Input{
		Files:            make([]staticprotocol.SourceFile, 0, len(files)),
		PrimaryFiles:     []staticprotocol.SourceFile{},
		SourceTextByFile: map[string]string{},
	}
	profileFiles := []devtools.SemanticSourceProfileFile{}
	for _, file := range files {
		cacheEntry := cacheEntries[file]
		read, readOK := readByFile[file]
		if readOK && read.err != nil {
			return Input{}, fmt.Errorf("read source for native static prepare %s: %w", read.file, read.err)
		}
		sourceFile := staticprotocol.SourceFile{
			File:       file,
			SourceHash: cacheEntry.SourceHash,
			CacheKey:   cacheEntry.CacheKey,
		}
		if readOK {
			sourceFile.SourceHash = read.sourceHash
			if profile, ok := profileFileFromRead(read); ok {
				profileFiles = append(profileFiles, profile)
			}
		} else if profile, ok := cachedProfile(file, cacheEntry); ok {
			profileFiles = append(profileFiles, profile)
		}
		if sourceFile.SourceHash == "" {
			return Input{}, fmt.Errorf("source hash for native static prepare %s was not prepared", file)
		}
		input.Files = append(input.Files, sourceFile)
		if primaryFileSet[file] {
			input.PrimaryFiles = append(input.PrimaryFiles, sourceFile)
		}
		if analyzeFileSet[file] {
			input.SourceTextByFile[file] = string(read.source)
		}
	}
	input.SemanticSourceProfile = ProfileFromFiles(profileFiles)
	return input, nil
}

func UniqueFiles(files []string) []string {
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

func readFiles(files []string) []sourceRead {
	reads := make([]sourceRead, len(files))
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
				reads[index] = readFile(files[index])
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

func readFile(file string) sourceRead {
	source, err := os.ReadFile(file)
	if err != nil {
		return sourceRead{file: file, err: err}
	}
	sum := sha256.Sum256(source)
	return sourceRead{
		file:       file,
		source:     source,
		sourceHash: fmt.Sprintf("%x", sum),
	}
}

func analyzeFileSet(files []string) map[string]bool {
	selected := make(map[string]bool, len(files))
	for _, file := range files {
		if file != "" {
			selected[file] = true
		}
	}
	return selected
}

func primaryFileSet(plan devtools.ProjectStaticSyntaxPlan) map[string]bool {
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

func AnalyzeFilesWithSourceText(files []staticprotocol.SourceFile, sourceTextByFile map[string]string) ([]staticprotocol.AnalyzeFile, error) {
	out := make([]staticprotocol.AnalyzeFile, 0, len(files))
	for _, file := range files {
		sourceText, ok := sourceTextByFile[file.File]
		if !ok {
			return nil, fmt.Errorf("source text for native static analyze %s was not prepared", file.File)
		}
		out = append(out, staticprotocol.AnalyzeFile{
			File:       file.File,
			SourceHash: file.SourceHash,
			SourceText: sourceText,
		})
	}
	return out, nil
}

func FilesToAnalyze(
	files []staticprotocol.SourceFile,
	filesToParse []string,
) []staticprotocol.SourceFile {
	selected := analyzeFileSet(filesToParse)
	out := make([]staticprotocol.SourceFile, 0, len(files))
	for _, file := range files {
		if selected[file.File] {
			out = append(out, file)
		}
	}
	return out
}

func AnalyzeFiles(files []staticprotocol.SourceFile) []staticprotocol.AnalyzeFile {
	out := make([]staticprotocol.AnalyzeFile, 0, len(files))
	for _, file := range files {
		out = append(out, staticprotocol.AnalyzeFile{
			File:       file.File,
			SourceHash: file.SourceHash,
		})
	}
	return out
}
