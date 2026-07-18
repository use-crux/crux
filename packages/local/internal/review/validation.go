package review

import (
	"bytes"
	"encoding/json"
	"io"
	"regexp"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/privacy"
)

type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

func invalid(message string) error { return &ValidationError{Message: message} }

const (
	maxCommentRunes    = 4_000
	maxDedupeKeyRunes  = 128
	maxCorrectionBytes = 64 * 1_024
	maxJSONDepth       = 12
	maxJSONListEntries = 1_000
)

var (
	runIDPattern        = regexp.MustCompile(`^run_[0-9a-f]{24}$`)
	emailPattern        = regexp.MustCompile(`(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{1,}`)
	secretTextPattern   = regexp.MustCompile(`(?i)\b(?:sk|pk|rk|key|token)-[A-Za-z0-9_-]{3,}\b`)
	sensitiveKeyPattern = regexp.MustCompile(`(?i)^(authorization|proxy[-_]?authorization|api[-_]?key|x[-_]?api[-_]?key|token|secret)$`)
)

func normalizeSubmission(input Submission, policy privacy.Policy) (Submission, error) {
	if !runIDPattern.MatchString(input.RunID) {
		return Submission{}, invalid("runId must be a valid Crux run ID")
	}
	if input.Rating != "up" && input.Rating != "down" {
		return Submission{}, invalid("rating must be up or down")
	}
	if len([]rune(input.Comment)) > maxCommentRunes {
		return Submission{}, invalid("comment is too long")
	}
	if len([]rune(input.DedupeKey)) > maxDedupeKeyRunes {
		return Submission{}, invalid("dedupeKey is too long")
	}
	correction, err := normalizeCorrection(input.Correction, policy.RedactPaths)
	if err != nil {
		return Submission{}, err
	}
	input.Comment = redactText(input.Comment)
	input.Correction = correction
	return input, nil
}

func normalizeCorrection(raw json.RawMessage, paths []string) (json.RawMessage, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	if len(raw) > maxCorrectionBytes {
		return nil, invalid("correction is too large")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, invalid("correction must be valid JSON")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return nil, invalid("correction must contain one JSON value")
	}
	redacted, err := redactJSON(value, 0, splitPaths(paths))
	if err != nil {
		return nil, err
	}
	normalized, err := json.Marshal(redacted)
	if err != nil || len(normalized) > maxCorrectionBytes {
		return nil, invalid("correction is too large")
	}
	return normalized, nil
}

func redactJSON(value any, depth int, paths [][]string) (any, error) {
	if depth > maxJSONDepth {
		return nil, invalid("correction exceeds maximum depth")
	}
	switch typed := value.(type) {
	case string:
		return redactText(typed), nil
	case []any:
		if len(typed) > maxJSONListEntries {
			return nil, invalid("correction list is too large")
		}
		out := make([]any, len(typed))
		for index, entry := range typed {
			var err error
			out[index], err = redactJSON(entry, depth+1, paths)
			if err != nil {
				return nil, err
			}
		}
		return out, nil
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, entry := range typed {
			matching := matchingPaths(paths, key)
			if sensitiveKeyPattern.MatchString(key) || hasTerminalPath(matching) {
				out[key] = "[redacted]"
				continue
			}
			redacted, err := redactJSON(entry, depth+1, remainingPaths(matching))
			if err != nil {
				return nil, err
			}
			out[key] = redacted
		}
		return out, nil
	default:
		return value, nil
	}
}

func normalizeContextSnapshot(input ContextSnapshot, policy privacy.Policy) (ContextSnapshot, error) {
	paths := splitPaths(policy.RedactPaths)
	var err error
	for _, field := range []*json.RawMessage{&input.Input, &input.Call, &input.Output} {
		if len(*field) == 0 {
			continue
		}
		*field, err = redactRawJSON(*field, paths)
		if err != nil {
			return ContextSnapshot{}, invalid("review context snapshot contains invalid JSON")
		}
	}
	input.Name = redactText(input.Name)
	input.Model = redactText(input.Model)
	input.Provider = redactText(input.Provider)
	input.PromptID = redactText(input.PromptID)
	return input, nil
}

func redactRawJSON(raw json.RawMessage, paths [][]string) (json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return nil, invalid("review context snapshot contains invalid JSON")
	}
	redacted, err := redactJSON(value, 0, paths)
	if err != nil {
		return nil, err
	}
	return json.Marshal(redacted)
}

func splitPaths(paths []string) [][]string {
	result := make([][]string, 0, len(paths))
	for _, path := range paths {
		result = append(result, strings.Split(path, "."))
	}
	return result
}

func matchingPaths(paths [][]string, key string) [][]string {
	result := make([][]string, 0, len(paths))
	for _, path := range paths {
		if len(path) > 0 && path[0] == key {
			result = append(result, path)
		}
	}
	return result
}

func hasTerminalPath(paths [][]string) bool {
	for _, path := range paths {
		if len(path) == 1 {
			return true
		}
	}
	return false
}

func remainingPaths(paths [][]string) [][]string {
	result := make([][]string, 0, len(paths))
	for _, path := range paths {
		if len(path) > 1 {
			result = append(result, path[1:])
		}
	}
	return result
}

func redactText(value string) string {
	value = emailPattern.ReplaceAllString(value, "[redacted-email]")
	value = secretTextPattern.ReplaceAllString(value, "[redacted-secret]")
	return strings.TrimSpace(value)
}
