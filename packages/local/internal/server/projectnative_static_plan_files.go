package server

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	projectNativeStaticMaxAuthoredSourceBytes = 1_000_000
	projectNativeStaticSampleBytes            = 128 * 1024
)

type projectNativeStaticFileSelectionResult struct {
	Files        []string
	PrimaryFiles []string
	Skipped      []json.RawMessage
}

type projectNativeStaticCandidateClassification struct {
	Action string `json:"action"`
	File   string `json:"file"`
	Bytes  int64  `json:"bytes"`
	Reason string `json:"reason,omitempty"`
}

func projectNativeStaticFileSelection(root string, configFile string) (projectNativeStaticFileSelectionResult, error) {
	return projectNativeStaticFileSelectionWithCallNames(root, configFile, nil)
}

func projectNativeStaticFileSelectionWithCallNames(
	root string,
	configFile string,
	callNames []string,
) (projectNativeStaticFileSelectionResult, error) {
	selection, _, err := projectNativeStaticFileSelectionWithCallNamesTimed(root, configFile, callNames)
	if err != nil {
		return projectNativeStaticFileSelectionResult{}, err
	}
	return selection, nil
}

func projectNativeStaticPrimaryCandidateFiles(root string, callNames []string) ([]string, []json.RawMessage, error) {
	files, skipped, _, err := projectNativeStaticPrimaryCandidateFilesTimed(root, callNames)
	if err != nil {
		return nil, nil, err
	}
	return files, skipped, nil
}

func projectNativeStaticClassifyCandidate(file string, callNames []string) projectNativeStaticCandidateClassification {
	return projectNativeStaticClassifyCandidateWithMatcher(file, projectNativeStaticSignalMatcherForCallNames(callNames))
}

func projectNativeStaticClassifyCandidateWithMatcher(
	file string,
	matcher projectNativeStaticSignalMatcher,
) projectNativeStaticCandidateClassification {
	fingerprint, ok := projectNativeStaticDiscoveryFingerprint(file)
	return projectNativeStaticClassifyCandidateWithMatcherAndFingerprint(file, matcher, fingerprint, ok)
}

func projectNativeStaticClassifyCandidateWithMatcherAndFingerprint(
	file string,
	matcher projectNativeStaticSignalMatcher,
	fingerprint projectNativeStaticDiscoveryFileFingerprint,
	fingerprintOK bool,
) projectNativeStaticCandidateClassification {
	if !projectNativeStaticCandidateSourceFile(file) {
		return projectNativeStaticCandidateClassification{Action: "skip", File: file, Reason: "unsupported-extension"}
	}
	if !fingerprintOK {
		return projectNativeStaticCandidateClassification{Action: "skip", File: file, Reason: "read-failed"}
	}
	bytes := fingerprint.Size
	sample, err := projectNativeStaticReadSample(file, minInt64(bytes, projectNativeStaticSampleBytes))
	if err != nil {
		return projectNativeStaticCandidateClassification{Action: "skip", File: file, Bytes: bytes, Reason: "read-failed"}
	}
	if projectNativeStaticConfigNames[filepath.Base(file)] {
		return projectNativeStaticCandidateClassification{Action: "index", File: file, Bytes: bytes}
	}
	if projectNativeStaticLooksBundled(file, sample) {
		return projectNativeStaticCandidateClassification{Action: "skip", File: file, Bytes: bytes, Reason: "bundled"}
	}
	if projectNativeStaticLooksGenerated(sample) {
		return projectNativeStaticCandidateClassification{Action: "skip", File: file, Bytes: bytes, Reason: "generated"}
	}
	hasCruxSignals := matcher.HasCruxInterest(sample)
	if bytes > projectNativeStaticMaxAuthoredSourceBytes && hasCruxSignals {
		return projectNativeStaticCandidateClassification{Action: "skip", File: file, Bytes: bytes, Reason: "too-large-authored"}
	}
	if projectNativeStaticLooksBase64Artifact(file, sample, bytes) {
		return projectNativeStaticCandidateClassification{Action: "skip", File: file, Bytes: bytes, Reason: "base64-artifact"}
	}
	if bytes > projectNativeStaticMaxAuthoredSourceBytes {
		return projectNativeStaticCandidateClassification{Action: "skip", File: file, Bytes: bytes, Reason: "too-large-uninteresting"}
	}
	if !hasCruxSignals {
		return projectNativeStaticCandidateClassification{Action: "skip", File: file, Bytes: bytes, Reason: "no-crux-signals"}
	}
	return projectNativeStaticCandidateClassification{Action: "index", File: file, Bytes: bytes}
}

func projectNativeStaticReadSample(file string, bytes int64) (string, error) {
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

func projectNativeStaticIgnoredDir(name string) bool {
	switch name {
	case "node_modules", ".git", ".next", ".turbo", "dist", "build", "coverage", "generated", ".venv", ".cache":
		return true
	default:
		return false
	}
}

func projectNativeStaticIgnoredSourcePath(root string, file string) bool {
	relative, err := filepath.Rel(root, file)
	if err != nil {
		return true
	}
	normalized := filepath.ToSlash(relative)
	base := filepath.Base(file)
	return strings.HasPrefix(normalized, ".crux/cache/") ||
		strings.Contains(normalized, "/.crux/cache/") ||
		projectNativeStaticGeneratedBuildOutputPath(normalized) ||
		strings.HasPrefix(normalized, "__tests__/") ||
		strings.HasPrefix(normalized, "__fixtures__/") ||
		strings.Contains(normalized, "/__tests__/") ||
		strings.Contains(normalized, "/__fixtures__/") ||
		strings.Contains(base, ".test.") ||
		strings.Contains(base, ".spec.") ||
		strings.HasSuffix(base, ".d.ts")
}

func projectNativeStaticGeneratedBuildOutputPath(relativeFile string) bool {
	return strings.HasPrefix(relativeFile, "packages/local/internal/server/embed/") ||
		strings.HasPrefix(relativeFile, "packages/local/internal/server/ui-embed/")
}

func projectNativeStaticCandidateSourceFile(file string) bool {
	if strings.HasSuffix(file, ".d.ts") {
		return false
	}
	if projectNativeStaticConfigNames[filepath.Base(file)] {
		return true
	}
	switch filepath.Ext(file) {
	case ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs":
		return true
	default:
		return false
	}
}

var projectNativeStaticCruxSignalPatterns = []*regexp.Regexp{
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

func projectNativeStaticHasCruxInterest(sample string, callNames []string) bool {
	return projectNativeStaticSignalMatcherForCallNames(callNames).HasCruxInterest(sample)
}

var projectNativeStaticGeneratedPattern = regexp.MustCompile(`(?i)(@generated|auto-generated|automatically generated|do not edit|do not modify)`)

func projectNativeStaticLooksGenerated(sample string) bool {
	return projectNativeStaticGeneratedPattern.MatchString(sample)
}

func projectNativeStaticLooksBundled(file string, sample string) bool {
	return strings.Contains(sample, "var __defProp = Object.defineProperty") ||
		strings.Contains(sample, "var __commonJS =") ||
		strings.Contains(sample, "__toESM") ||
		strings.Contains(sample, "node_modules/.pnpm/") ||
		strings.Contains(sample, "//# sourceMappingURL=") ||
		projectNativeStaticLooksHashedAssetChunk(file, sample)
}

var projectNativeStaticHashedAssetChunkPattern = regexp.MustCompile(`/assets/[^/]+-[A-Za-z0-9_-]{8,}\.(?:[cm]?js|jsx)$`)

func projectNativeStaticLooksHashedAssetChunk(file string, sample string) bool {
	normalized := filepath.ToSlash(file)
	if !projectNativeStaticHashedAssetChunkPattern.MatchString(normalized) {
		return false
	}
	return strings.HasPrefix(sample, "import{") || strings.Contains(sample, `from"./`) || projectNativeStaticLongestLine(sample) > 2000
}

var projectNativeStaticWhitespacePattern = regexp.MustCompile(`\s+`)

func projectNativeStaticLooksBase64Artifact(file string, sample string, bytes int64) bool {
	if bytes < 256_000 {
		return false
	}
	name := strings.ToLower(filepath.Base(file))
	artifactName := strings.Contains(name, "wasm") || strings.Contains(name, "base64")
	longest := projectNativeStaticLongestLine(sample)
	if artifactName && longest > 50_000 {
		return true
	}
	if longest < 100_000 {
		return false
	}
	compact := projectNativeStaticWhitespacePattern.ReplaceAllString(sample, "")
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
