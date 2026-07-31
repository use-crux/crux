package preview

import (
	"encoding/json"
	"fmt"
)

func validateReady(result ReadyResult, targetID string, revision uint64) error {
	preview := result.Preview
	if result.Status != "ready" || result.TargetID != targetID ||
		result.CatalogueRevision != revision ||
		!oneOf(preview.Status, "fits", "over-limit", "unknown") ||
		!oneOf(preview.Measurement, "exact", "estimated", "conservative", "incomplete") ||
		preview.Adaptations == nil || preview.Warnings == nil || preview.Diagnostics == nil ||
		result.Contributions == nil || invalidOptionalCount(preview.InputTokens) ||
		invalidOptionalCount(preview.MaxInputTokens) || len(preview.Adaptations) > 1024 ||
		len(preview.Warnings) > 1024 || len(preview.Diagnostics) > 1024 ||
		len(result.Contributions) > 1024 || utf16Length(preview.Model) > 512 {
		return fmt.Errorf("invalid ready result")
	}
	for _, adaptation := range preview.Adaptations {
		if !validScalar(adaptation.Contributor, 1, 512) ||
			!oneOf(adaptation.Representation, "authored", "summary", "offload", "omitted") ||
			!oneOf(adaptation.State, "selected", "unprepared") ||
			invalidOptionalCount(adaptation.FullTokens) ||
			invalidOptionalCount(adaptation.SelectedTokens) {
			return fmt.Errorf("invalid adaptation")
		}
	}
	for _, warning := range preview.Warnings {
		if !validScalar(warning.Code, 1, 128) || utf16Length(warning.Message) > 2048 {
			return fmt.Errorf("invalid warning")
		}
	}
	for _, diagnostic := range preview.Diagnostics {
		if !validScalar(diagnostic.ID, 1, 512) || !validScalar(diagnostic.Code, 1, 128) ||
			utf16Length(diagnostic.Message) > 2048 ||
			!validOptionalScalar(diagnostic.Contributor, 512) ||
			invalidOptionalCount(diagnostic.Tokens) {
			return fmt.Errorf("invalid diagnostic")
		}
	}
	for _, contribution := range result.Contributions {
		if !validScalar(contribution.ID, 1, 512) ||
			!oneOf(contribution.Boundary, "required", "sticky", "elastic") ||
			len(contribution.Representations) == 0 || len(contribution.Representations) > 5 {
			return fmt.Errorf("invalid contribution")
		}
		for _, representation := range contribution.Representations {
			if !oneOf(representation, "full", "authored", "summary", "offload", "omitted") {
				return fmt.Errorf("invalid contribution representation")
			}
		}
	}
	return nil
}

func invalidOptionalCount(value *int) bool {
	return value != nil && (*value < 0 || uint64(*value) > MaxSafeInteger)
}

func validScalar(value string, minimum, maximum int) bool {
	length := utf16Length(value)
	return length >= minimum && length <= maximum
}

func validOptionalScalar(value string, maximum int) bool {
	return value == "" || validScalar(value, 1, maximum)
}

func oneOf(value string, values ...string) bool {
	for _, candidate := range values {
		if value == candidate {
			return true
		}
	}
	return false
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
				if value < 0 || value > float64(MaxSafeInteger) || value != float64(uint64(value)) {
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
