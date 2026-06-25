package lint

import (
	"os"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

const suppressionPrefix = "crux-lint-disable-"

// SuppressionsFromSourceText returns prepared lint suppressions from source
// text that the Static Index source profile already loaded.
func SuppressionsFromSourceText(sourceTextByFile map[string]string) []protocol.LintSuppression {
	files := make([]string, 0, len(sourceTextByFile))
	for file := range sourceTextByFile {
		files = append(files, file)
	}
	sort.Strings(files)

	out := []protocol.LintSuppression{}
	for _, file := range files {
		out = append(out, ParseSuppressions(file, sourceTextByFile[file])...)
	}
	return out
}

// SuppressionsFromFiles returns prepared lint suppressions from source files.
func SuppressionsFromFiles(files []string) []protocol.LintSuppression {
	out := []protocol.LintSuppression{}
	for _, file := range files {
		source, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		out = append(out, ParseSuppressions(file, string(source))...)
	}
	return out
}

// ParseSuppressions parses Crux lint suppression comments in one source file.
func ParseSuppressions(file string, source string) []protocol.LintSuppression {
	out := []protocol.LintSuppression{}
	for index, line := range strings.Split(source, "\n") {
		if suppression, ok := parseSuppressionLine(file, index+1, line); ok {
			out = append(out, suppression)
		}
	}
	return out
}

func parseSuppressionLine(file string, lineNumber int, line string) (protocol.LintSuppression, bool) {
	column := strings.Index(line, suppressionPrefix)
	if column < 0 {
		return protocol.LintSuppression{}, false
	}
	rest := strings.TrimLeft(line[column+len(suppressionPrefix):], " \t")
	scope := ""
	for _, candidate := range []string{"next-line", "line", "file"} {
		if strings.HasPrefix(rest, candidate) {
			scope = candidate
			rest = strings.TrimLeft(rest[len(candidate):], " \t")
			break
		}
	}
	if scope == "" {
		return protocol.LintSuppression{}, false
	}
	ruleLength := 0
	for _, character := range rest {
		if !isRuleCharacter(character) {
			break
		}
		ruleLength++
	}
	if ruleLength == 0 {
		return protocol.LintSuppression{}, false
	}
	return protocol.LintSuppression{
		File:   file,
		Line:   lineNumber,
		Column: column + 1,
		Scope:  scope,
		RuleID: rest[:ruleLength],
	}, true
}

func isRuleCharacter(character rune) bool {
	return character >= 'a' && character <= 'z' ||
		character >= 'A' && character <= 'Z' ||
		character >= '0' && character <= '9' ||
		strings.ContainsRune("@_./-", character)
}
