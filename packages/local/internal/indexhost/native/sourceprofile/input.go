package sourceprofile

import (
	"crypto/sha256"
	"fmt"
	"os"
	"runtime"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/indexhost/native/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

type Input struct {
	Files                 []protocol.SourceFile
	PrimaryFiles          []protocol.SourceFile
	SourceTextByFile      map[string]string
	SemanticSourceProfile *projectindex.SemanticSourceProfile
}

type sourceRead struct {
	file       string
	source     []byte
	sourceHash string
	err        error
}

func FromPlan(plan projectindex.ProjectStaticSyntaxPlan) (Input, error) {
	filesToParse := filesToParse(plan)
	cacheEntries := cacheEntries(plan.CacheEntries)
	primaryFileSet := primaryFileSet(plan)
	analyzeFileSet := analyzeFileSet(filesToParse)
	files := inputFiles(plan)
	reads := readFiles(filesToRead(files, analyzeFileSet, cacheEntries))
	readByFile := readMap(reads)
	input := Input{
		Files:            make([]protocol.SourceFile, 0, len(files)),
		PrimaryFiles:     []protocol.SourceFile{},
		SourceTextByFile: map[string]string{},
	}
	profileFiles := []projectindex.SemanticSourceProfileFile{}
	for _, file := range files {
		cacheEntry := cacheEntries[file]
		read, readOK := readByFile[file]
		if readOK && read.err != nil {
			return Input{}, fmt.Errorf("read source for native static prepare %s: %w", read.file, read.err)
		}
		sourceFile := protocol.SourceFile{
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

func primaryFileSet(plan projectindex.ProjectStaticSyntaxPlan) map[string]bool {
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

func AnalyzeFilesWithSourceText(files []protocol.SourceFile, sourceTextByFile map[string]string) ([]protocol.AnalyzeFile, error) {
	out := make([]protocol.AnalyzeFile, 0, len(files))
	for _, file := range files {
		sourceText, ok := sourceTextByFile[file.File]
		if !ok {
			return nil, fmt.Errorf("source text for native static analyze %s was not prepared", file.File)
		}
		out = append(out, protocol.AnalyzeFile{
			File:       file.File,
			SourceHash: file.SourceHash,
			SourceText: sourceText,
		})
	}
	return out, nil
}

func filesToParse(plan projectindex.ProjectStaticSyntaxPlan) []string {
	if plan.FilesToParse != nil {
		return plan.FilesToParse
	}
	return plan.Files
}

func FilesToAnalyze(
	files []protocol.SourceFile,
	filesToParse []string,
) []protocol.SourceFile {
	selected := analyzeFileSet(filesToParse)
	out := make([]protocol.SourceFile, 0, len(files))
	for _, file := range files {
		if selected[file.File] {
			out = append(out, file)
		}
	}
	return out
}

func AnalyzeFiles(files []protocol.SourceFile) []protocol.AnalyzeFile {
	out := make([]protocol.AnalyzeFile, 0, len(files))
	for _, file := range files {
		out = append(out, protocol.AnalyzeFile{
			File:       file.File,
			SourceHash: file.SourceHash,
		})
	}
	return out
}
