package planner

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	maxAuthoredSourceBytes = 1_000_000
	sampleBytes            = 128 * 1024
)

type fileSelectionResult struct {
	Files        []string
	PrimaryFiles []string
	Skipped      []json.RawMessage
}

type candidateClassification struct {
	Action string `json:"action"`
	File   string `json:"file"`
	Bytes  int64  `json:"bytes"`
	Reason string `json:"reason,omitempty"`
}

func fileSelection(root string, configFile string) (fileSelectionResult, error) {
	return fileSelectionWithCallNames(root, configFile, nil)
}

func fileSelectionWithCallNames(
	root string,
	configFile string,
	callNames []string,
) (fileSelectionResult, error) {
	selection, _, err := fileSelectionWithCallNamesTimed(root, configFile, callNames)
	if err != nil {
		return fileSelectionResult{}, err
	}
	return selection, nil
}

func primaryCandidateFiles(root string, callNames []string) ([]string, []json.RawMessage, error) {
	files, skipped, _, err := primaryCandidateFilesTimed(root, callNames)
	if err != nil {
		return nil, nil, err
	}
	return files, skipped, nil
}

func classifyCandidate(file string, callNames []string) candidateClassification {
	return classifyCandidateWithMatcher(file, signalMatcherForCallNames(callNames))
}

func classifyCandidateWithMatcher(
	file string,
	matcher signalMatcher,
) candidateClassification {
	fingerprint, ok := discoveryFingerprint(file)
	return classifyCandidateWithMatcherAndFingerprint(file, matcher, fingerprint, ok)
}

func classifyCandidateWithMatcherAndFingerprint(
	file string,
	matcher signalMatcher,
	fingerprint discoveryFileFingerprint,
	fingerprintOK bool,
) candidateClassification {
	if !candidateSourceFile(file) {
		return candidateClassification{Action: "skip", File: file, Reason: "unsupported-extension"}
	}
	if !fingerprintOK {
		return candidateClassification{Action: "skip", File: file, Reason: "read-failed"}
	}
	bytes := fingerprint.Size
	sample, err := readSample(file, minInt64(bytes, sampleBytes))
	if err != nil {
		return candidateClassification{Action: "skip", File: file, Bytes: bytes, Reason: "read-failed"}
	}
	if configNames[filepath.Base(file)] {
		return candidateClassification{Action: "index", File: file, Bytes: bytes}
	}
	if looksBundled(file, sample) {
		return candidateClassification{Action: "skip", File: file, Bytes: bytes, Reason: "bundled"}
	}
	if looksGenerated(sample) {
		return candidateClassification{Action: "skip", File: file, Bytes: bytes, Reason: "generated"}
	}
	hasCruxSignals := matcher.HasCruxInterest(sample)
	if bytes > maxAuthoredSourceBytes && hasCruxSignals {
		return candidateClassification{Action: "skip", File: file, Bytes: bytes, Reason: "too-large-authored"}
	}
	if looksBase64Artifact(file, sample, bytes) {
		return candidateClassification{Action: "skip", File: file, Bytes: bytes, Reason: "base64-artifact"}
	}
	if bytes > maxAuthoredSourceBytes {
		return candidateClassification{Action: "skip", File: file, Bytes: bytes, Reason: "too-large-uninteresting"}
	}
	if !hasCruxSignals {
		return candidateClassification{Action: "skip", File: file, Bytes: bytes, Reason: "no-crux-signals"}
	}
	return candidateClassification{Action: "index", File: file, Bytes: bytes}
}

func readSample(file string, bytes int64) (string, error) {
	if bytes <= 0 {
		return "", nil
	}
	handle, err := os.Open(file)
	if err != nil {
		return "", err
	}
	defer handle.Close()
	buffer := make([]byte, bytes)
	read, err := io.ReadFull(handle, buffer)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return "", err
	}
	return string(buffer[:read]), nil
}

func ignoredDir(name string) bool {
	switch name {
	case "node_modules", ".git", ".next", ".turbo", ".tmp", "dist", "build", "coverage", "generated", ".venv", ".cache":
		return true
	default:
		return false
	}
}

func ignoredSourcePath(root string, file string) bool {
	relative, err := filepath.Rel(root, file)
	if err != nil {
		return true
	}
	normalized := filepath.ToSlash(relative)
	base := filepath.Base(file)
	return strings.HasPrefix(normalized, ".crux/cache/") ||
		strings.Contains(normalized, "/.crux/cache/") ||
		generatedBuildOutputPath(normalized) ||
		strings.HasPrefix(normalized, "__tests__/") ||
		strings.HasPrefix(normalized, "__fixtures__/") ||
		strings.Contains(normalized, "/__tests__/") ||
		strings.Contains(normalized, "/__fixtures__/") ||
		strings.Contains(base, ".test.") ||
		strings.Contains(base, ".spec.") ||
		strings.HasSuffix(base, ".d.ts")
}

func generatedBuildOutputPath(relativeFile string) bool {
	return strings.HasPrefix(relativeFile, "packages/local/internal/assets/embed/") ||
		strings.HasPrefix(relativeFile, "packages/local/internal/assets/ui-embed/")
}

func candidateSourceFile(file string) bool {
	if strings.HasSuffix(file, ".d.ts") {
		return false
	}
	if configNames[filepath.Base(file)] {
		return true
	}
	switch filepath.Ext(file) {
	case ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs":
		return true
	default:
		return false
	}
}

var cruxSignalPatterns = []*regexp.Regexp{
	regexp.MustCompile(`@crux/`),
	regexp.MustCompile(`\bprompt\s*\(`),
	regexp.MustCompile(`\bcontext\s*\(`),
	regexp.MustCompile(`\btool\s*\(`),
	regexp.MustCompile(`\bagent\s*\(`),
	regexp.MustCompile(`\bconvexAgent\s*\(`),
	regexp.MustCompile(`\bflow\s*\(`),
	regexp.MustCompile(`\bcruxFlow\s*\(`),
	regexp.MustCompile(`\bparallel\s*\(`),
	regexp.MustCompile(`\bpipeline\s*\(`),
	regexp.MustCompile(`\bswarm\s*\(`),
	regexp.MustCompile(`\bconsensus\s*\(`),
	regexp.MustCompile(`\bmemory\s*\(`),
	regexp.MustCompile(`\bworkingState\s*\(`),
	regexp.MustCompile(`\bblackboard\s*\(`),
	regexp.MustCompile(`\bretriever\s*\(`),
	regexp.MustCompile(`\bretrievalPipeline\s*\(`),
	regexp.MustCompile(`\bworkspace\s*\(`),
	regexp.MustCompile(`\bconstraint\s*\(`),
	regexp.MustCompile(`\bguardrail\s*\(`),
	regexp.MustCompile(`\bscorer\s*\(`),
	regexp.MustCompile(`\bllmJudge\s*\(`),
	regexp.MustCompile(`\bevaluation\s*\(`),
	regexp.MustCompile(`\bsuite\s*\(`),
	regexp.MustCompile(`\bnew\s+Agent\s*\(`),
}

func hasCruxInterest(sample string, callNames []string) bool {
	return signalMatcherForCallNames(callNames).HasCruxInterest(sample)
}

var generatedPattern = regexp.MustCompile(`(?i)(@generated|auto-generated|automatically generated|do not edit|do not modify)`)

func looksGenerated(sample string) bool {
	return generatedPattern.MatchString(sample)
}

func looksBundled(file string, sample string) bool {
	return strings.Contains(sample, "var __defProp = Object.defineProperty") ||
		strings.Contains(sample, "var __commonJS =") ||
		strings.Contains(sample, "__toESM") ||
		strings.Contains(sample, "node_modules/.pnpm/") ||
		strings.Contains(sample, "//# sourceMappingURL=") ||
		looksHashedAssetChunk(file, sample)
}

var hashedAssetChunkPattern = regexp.MustCompile(`/assets/[^/]+-[A-Za-z0-9_-]{8,}\.(?:[cm]?js|jsx)$`)

func looksHashedAssetChunk(file string, sample string) bool {
	normalized := filepath.ToSlash(file)
	if !hashedAssetChunkPattern.MatchString(normalized) {
		return false
	}
	return strings.HasPrefix(sample, "import{") || strings.Contains(sample, `from"./`) || longestLine(sample) > 2000
}

var whitespacePattern = regexp.MustCompile(`\s+`)

func looksBase64Artifact(file string, sample string, bytes int64) bool {
	if bytes < 256_000 {
		return false
	}
	name := strings.ToLower(filepath.Base(file))
	artifactName := strings.Contains(name, "wasm") || strings.Contains(name, "base64")
	longest := longestLine(sample)
	if artifactName && longest > 50_000 {
		return true
	}
	if longest < 100_000 {
		return false
	}
	compact := whitespacePattern.ReplaceAllString(sample, "")
	if compact == "" {
		return false
	}
	base64Chars := 0
	for _, character := range compact {
		if (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') || character == '+' || character == '/' || character == '=' {
			base64Chars++
		}
	}
	return float64(base64Chars)/float64(len(compact)) > 0.95
}
