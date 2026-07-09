package quality

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

const diskSourceFrameRadius = 4

var diskSourceFrameExtensions = map[string]bool{
	".cjs": true,
	".cts": true,
	".js":  true,
	".jsx": true,
	".mjs": true,
	".mts": true,
	".ts":  true,
	".tsx": true,
}

var generatedSourceFrameSegments = map[string]bool{
	".next":        true,
	"build":        true,
	"coverage":     true,
	"dist":         true,
	"node_modules": true,
	"out":          true,
}

func diskSourceFrameRoot(qualityDir string) string {
	if qualityDir == "" {
		return ""
	}
	cruxDir := filepath.Dir(qualityDir)
	if filepath.Base(cruxDir) == ".crux" {
		return filepath.Dir(cruxDir)
	}
	return filepath.Dir(qualityDir)
}

func resolveDiskSourceFrame(sourceRef string, sourceRoot string) api.QualitySourceFrame {
	parsed, ok := parseDiskSourceRef(sourceRef)
	if !ok {
		return api.QualitySourceFrame{Kind: "unavailable", Reason: "invalid-source-ref", SourceRef: sourceRef}
	}

	file := parsed.file
	if !filepath.IsAbs(file) {
		if sourceRoot == "" {
			return api.QualitySourceFrame{Kind: "unavailable", Reason: "source-root-missing", SourceRef: sourceRef}
		}
		file = filepath.Join(sourceRoot, file)
	}
	file = filepath.Clean(file)
	if !diskSourceFrameWithinRoot(file, sourceRoot) {
		return api.QualitySourceFrame{Kind: "unavailable", Reason: "source-outside-root", SourceRef: sourceRef}
	}

	if !diskSourceFrameExtensions[strings.ToLower(filepath.Ext(file))] {
		return api.QualitySourceFrame{Kind: "unavailable", Reason: "unsupported-source-file", SourceRef: sourceRef}
	}
	if hasGeneratedSourceFrameSegment(file) {
		return api.QualitySourceFrame{Kind: "unavailable", Reason: "source-map-missing", SourceRef: sourceRef}
	}

	content, err := os.ReadFile(file)
	if err != nil {
		return api.QualitySourceFrame{Kind: "unavailable", Reason: "source-file-missing", SourceRef: sourceRef}
	}
	lines := strings.Split(strings.ReplaceAll(string(content), "\r\n", "\n"), "\n")
	if parsed.line < 1 || parsed.line > len(lines) {
		return api.QualitySourceFrame{Kind: "unavailable", Reason: "source-line-missing", SourceRef: sourceRef}
	}

	start := max(1, parsed.line-diskSourceFrameRadius)
	end := min(len(lines), parsed.line+diskSourceFrameRadius)
	frameLines := make([]api.QualitySourceFrameLine, 0, end-start+1)
	for line := start; line <= end; line++ {
		role := "context"
		if line == parsed.line {
			role = "failed"
		}
		frameLines = append(frameLines, api.QualitySourceFrameLine{
			Line: line,
			Text: lines[line-1],
			Role: role,
		})
	}

	sum := sha256.Sum256([]byte(strings.Join(lines[start-1:end], "\n")))
	return api.QualitySourceFrame{
		Kind:           "source-frame",
		SourceRef:      sourceRef,
		AuthoredFile:   file,
		AuthoredLine:   parsed.line,
		AuthoredColumn: parsed.column,
		FrameStartLine: start,
		FrameEndLine:   end,
		Lines:          frameLines,
		ContentHash:    fmt.Sprintf("sha256:%x", sum[:]),
		CapturedAt:     time.Now().UTC().Format(time.RFC3339Nano),
		Stale:          true,
		Resolver:       "disk",
	}
}

func diskSourceFrameWithinRoot(file string, sourceRoot string) bool {
	if sourceRoot == "" {
		return false
	}
	root, err := filepath.Abs(filepath.Clean(sourceRoot))
	if err != nil {
		return false
	}
	resolved, err := filepath.Abs(filepath.Clean(file))
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil {
		return false
	}
	return rel != "." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)) && rel != ".." && !filepath.IsAbs(rel)
}

type diskSourceRef struct {
	file   string
	line   int
	column *int
}

func parseDiskSourceRef(sourceRef string) (diskSourceRef, bool) {
	sourceRef = strings.TrimSpace(sourceRef)
	if sourceRef == "" {
		return diskSourceRef{}, false
	}

	fileAndLine := sourceRef
	var column *int
	if index := strings.LastIndex(sourceRef, ":"); index >= 0 {
		if value, err := strconv.Atoi(sourceRef[index+1:]); err == nil {
			column = &value
			fileAndLine = sourceRef[:index]
		}
	}

	index := strings.LastIndex(fileAndLine, ":")
	if index < 0 || index == 0 {
		return diskSourceRef{}, false
	}
	file := fileAndLine[:index]
	lineText := fileAndLine[index+1:]
	line, err := strconv.Atoi(lineText)
	if err != nil || line < 1 {
		return diskSourceRef{}, false
	}

	return diskSourceRef{file: file, line: line, column: column}, true
}

func hasGeneratedSourceFrameSegment(file string) bool {
	for _, segment := range strings.Split(filepath.ToSlash(file), "/") {
		if generatedSourceFrameSegments[segment] {
			return true
		}
	}
	return false
}

func normalizeAssertionOutcomeSourceFrames(outcomes []api.QualityAssertionOutcome) {
	for index := range outcomes {
		outcome := &outcomes[index]
		if outcome.SourceFrame == nil || outcome.SourceFrame.Kind != "source-frame" || outcome.SubjectExpr == "" {
			continue
		}
		reanchorSourceFrame(outcome.SourceFrame, outcome.SubjectExpr, roleForOutcome(outcome.Status))
		if outcome.SourceFrame.SourceRef != "" {
			outcome.SourceRef = outcome.SourceFrame.SourceRef
		}
	}
}

func reanchorSourceFrame(frame *api.QualitySourceFrame, subjectExpr string, role string) {
	if frame == nil || frame.Kind != "source-frame" || subjectExpr == "" {
		return
	}
	if sourceFrameAuthoredLineContains(*frame, subjectExpr) {
		return
	}
	lineIndex := sourceFrameLineIndex(frame.Lines, subjectExpr)
	if lineIndex < 0 {
		return
	}

	line := frame.Lines[lineIndex]
	column := sourceFrameColumn(line.Text)
	frame.AuthoredLine = line.Line
	frame.AuthoredColumn = &column
	frame.SourceRef = sourceRefForFrame(*frame, column)
	for index := range frame.Lines {
		frame.Lines[index].Role = "context"
	}
	frame.Lines[lineIndex].Role = role
}

func sourceFrameAuthoredLineContains(frame api.QualitySourceFrame, subjectExpr string) bool {
	for _, line := range frame.Lines {
		if line.Line == frame.AuthoredLine && strings.Contains(line.Text, subjectExpr) {
			return true
		}
	}
	return false
}

func sourceFrameLineIndex(lines []api.QualitySourceFrameLine, subjectExpr string) int {
	for index, line := range lines {
		if strings.Contains(line.Text, subjectExpr) {
			return index
		}
	}
	return -1
}

func sourceFrameColumn(line string) int {
	if index := strings.Index(line, "expect("); index >= 0 {
		return index + 1
	}
	if index := strings.Index(line, "expect.soft("); index >= 0 {
		return index + 1
	}
	if index := strings.Index(line, "ctx.expect("); index >= 0 {
		return index + 1
	}
	trimmed := strings.TrimLeft(line, " \t")
	return len(line) - len(trimmed) + 1
}

func sourceRefForFrame(frame api.QualitySourceFrame, column int) string {
	file := nonEmptyString(frame.AuthoredFile, frame.SourceRef)
	if parsed, ok := parseDiskSourceRef(file); ok {
		file = parsed.file
	}
	return fmt.Sprintf("%s:%d:%d", file, frame.AuthoredLine, column)
}

func roleForOutcome(status string) string {
	switch status {
	case "passed":
		return "passed"
	case "not-evaluated", "uncaptured":
		return "not-evaluated"
	default:
		return "failed"
	}
}
