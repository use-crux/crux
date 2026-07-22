package lint

import (
	"os"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

const suppressionPrefix = "crux-lint-disable-"

// SuppressionsFromFiles returns prepared lint suppressions from source files.
func SuppressionsFromFiles(files []string) []protocol.LintSuppression {
	files = append([]string(nil), files...)
	sort.Strings(files)
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
	var scope protocol.LintSuppressionScope
	for _, candidate := range []protocol.LintSuppressionScope{
		protocol.LintSuppressionNextLine,
		protocol.LintSuppressionLine,
		protocol.LintSuppressionFile,
	} {
		token := string(candidate)
		if strings.HasPrefix(rest, token) && hasScopeDelimiter(rest[len(token):]) {
			scope = candidate
			rest = strings.TrimLeft(rest[len(token):], " \t")
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
	reason := ""
	tail := strings.TrimSpace(rest[ruleLength:])
	if strings.HasPrefix(tail, "--") {
		reason = strings.TrimSpace(tail[2:])
	}
	return protocol.LintSuppression{
		File:   file,
		Line:   lineNumber,
		Column: column + 1,
		Scope:  scope,
		RuleID: rest[:ruleLength],
		Reason: reason,
	}, true
}

func hasScopeDelimiter(rest string) bool {
	return len(rest) > 0 && (rest[0] == ' ' || rest[0] == '\t')
}

func isRuleCharacter(character rune) bool {
	return character >= 'a' && character <= 'z' ||
		character >= 'A' && character <= 'Z' ||
		character >= '0' && character <= '9' ||
		strings.ContainsRune("@_./-", character)
}
