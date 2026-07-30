package preview

import (
	"encoding/json"
	"fmt"
	"strings"
)

func validateReady(result ReadyResult, targetID string, revision uint64) error {
	if result.Status != "ready" || result.TargetID != targetID ||
		result.CatalogueRevision != revision || result.Inspection.System.Parts == nil ||
		result.Inspection.DroppedContexts == nil || result.Inspection.ExcludedContexts == nil ||
		result.Inspection.TotalTokens < 0 || result.Inspection.System.Tokens < 0 ||
		invalidOptionalCount(result.Inspection.TokenBudget) ||
		len(result.Inspection.System.Parts) > 1024 ||
		len(result.Inspection.DroppedContexts) > 1024 ||
		len(result.Inspection.ExcludedContexts) > 1024 ||
		len(result.Inspection.Tools) > 1024 {
		return fmt.Errorf("invalid ready result")
	}
	stringBytes, segments := len([]byte(result.TargetID)), 0
	parts := make([]string, 0, len(result.Inspection.System.Parts))
	for _, part := range result.Inspection.System.Parts {
		if part.Source == "" || utf16Length(part.Source) > 512 ||
			part.Tokens < 0 || part.Segments == nil ||
			invalidOptionalCount(part.StaticTokens) ||
			invalidOptionalCount(part.DynamicTokens) ||
			validateSegments(part.Text, part.Segments) != nil {
			return fmt.Errorf("invalid system part")
		}
		if !part.Skipped && part.Text != "" {
			parts = append(parts, part.Text)
		}
		stringBytes += len([]byte(part.Source)) + len([]byte(part.Text))
		segments += len(part.Segments)
	}
	expectedCoverage := "partial"
	if strings.Join(parts, "\n\n") == result.Inspection.System.Text {
		expectedCoverage = "complete"
	}
	if result.Inspection.System.Coverage != expectedCoverage {
		return fmt.Errorf("invalid coverage")
	}
	stringBytes += len([]byte(result.Inspection.System.Text))
	if prompt := result.Inspection.Prompt; prompt != nil {
		if prompt.Tokens < 0 || prompt.Segments == nil ||
			invalidOptionalCount(prompt.StaticTokens) ||
			invalidOptionalCount(prompt.DynamicTokens) ||
			validateSegments(prompt.Text, prompt.Segments) != nil {
			return fmt.Errorf("invalid prompt")
		}
		stringBytes += len([]byte(prompt.Text))
		segments += len(prompt.Segments)
	}
	for _, dropped := range result.Inspection.DroppedContexts {
		if dropped.Source == "" || utf16Length(dropped.Source) > 512 ||
			dropped.Tokens < 0 || dropped.Segments == nil ||
			validateSegments(dropped.Text, dropped.Segments) != nil {
			return fmt.Errorf("invalid dropped context")
		}
		stringBytes += len([]byte(dropped.Source)) + len([]byte(dropped.Text))
		segments += len(dropped.Segments)
	}
	for _, excluded := range result.Inspection.ExcludedContexts {
		if excluded.Source == "" || utf16Length(excluded.Source) > 512 ||
			utf16Length(excluded.Reason) > 1024 {
			return fmt.Errorf("invalid excluded context")
		}
		stringBytes += len([]byte(excluded.Source)) + len([]byte(excluded.Reason))
	}
	for _, tool := range result.Inspection.Tools {
		if tool == "" || utf16Length(tool) > 512 {
			return fmt.Errorf("invalid tool")
		}
		stringBytes += len([]byte(tool))
	}
	if stringBytes > MaxResultStringBytes || segments > MaxResultSegments {
		return fmt.Errorf("result limit")
	}
	return nil
}

func validateSegments(text string, segments []Segment) error {
	if text == "" {
		if len(segments) != 0 {
			return fmt.Errorf("segments for empty text")
		}
		return nil
	}
	boundaries := utf16Boundaries(text)
	cursor := 0
	for _, segment := range segments {
		if segment.Kind != "static" && segment.Kind != "dynamic" && segment.Kind != "unknown" {
			return fmt.Errorf("invalid segment kind")
		}
		if segment.StartUTF16 != cursor || segment.EndUTF16 <= cursor ||
			!boundaries[segment.StartUTF16] || !boundaries[segment.EndUTF16] {
			return fmt.Errorf("invalid segment range")
		}
		if utf16Length(segment.Source) > 512 || utf16Length(segment.SourceVersion) > 256 ||
			(segment.ObservedAt != nil && *segment.ObservedAt > MaxSafeInteger) {
			return fmt.Errorf("invalid segment metadata")
		}
		cursor = segment.EndUTF16
	}
	if !boundaries[cursor] || cursor != utf16Length(text) {
		return fmt.Errorf("incomplete segments")
	}
	return nil
}

func invalidOptionalCount(value *int) bool {
	return value != nil && *value < 0
}

func utf16Boundaries(value string) map[int]bool {
	out := map[int]bool{0: true}
	offset := 0
	for _, r := range value {
		if r > 0xffff {
			offset += 2
		} else {
			offset++
		}
		out[offset] = true
	}
	return out
}

func utf16Length(value string) int {
	length := 0
	for _, r := range value {
		if r > 0xffff {
			length += 2
		} else {
			length++
		}
	}
	return length
}

func validateValidation(result ValidationResult, targetID string, revision uint64) error {
	if result.Status != "validation-error" || result.TargetID != targetID ||
		result.CatalogueRevision != revision || result.Issues == nil ||
		len(result.Issues) > 128 || result.OmittedIssueCount < 0 {
		return fmt.Errorf("invalid validation result")
	}
	for _, issue := range result.Issues {
		if issue.Code == "" || utf16Length(issue.Code) > 64 || issue.Message == "" ||
			utf16Length(issue.Message) > 1024 || len(issue.Path) > 32 {
			return fmt.Errorf("invalid validation issue")
		}
		for _, element := range issue.Path {
			switch value := element.(type) {
			case string:
				if utf16Length(value) > 256 {
					return fmt.Errorf("invalid issue path")
				}
			case float64:
				if value < 0 || value > float64(MaxSafeInteger) ||
					value != float64(uint64(value)) {
					return fmt.Errorf("invalid issue path")
				}
			default:
				return fmt.Errorf("invalid issue path")
			}
		}
	}
	return nil
}

func containsJSONNull(data []byte) bool {
	var value any
	if json.Unmarshal(data, &value) != nil {
		return false
	}
	var visit func(any) bool
	visit = func(candidate any) bool {
		switch typed := candidate.(type) {
		case nil:
			return true
		case []any:
			for _, child := range typed {
				if visit(child) {
					return true
				}
			}
		case map[string]any:
			for _, child := range typed {
				if visit(child) {
					return true
				}
			}
		}
		return false
	}
	return visit(value)
}

func countStringBytes(data []byte) int {
	var value any
	if json.Unmarshal(data, &value) != nil {
		return MaxResultStringBytes + 1
	}
	var count func(any) int
	count = func(candidate any) int {
		switch typed := candidate.(type) {
		case string:
			return len([]byte(typed))
		case []any:
			total := 0
			for _, child := range typed {
				total += count(child)
			}
			return total
		case map[string]any:
			total := 0
			for _, child := range typed {
				total += count(child)
			}
			return total
		default:
			return 0
		}
	}
	return count(value)
}
