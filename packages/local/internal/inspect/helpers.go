package inspect

func appendUniqueString(values []string, next string) []string {
	if next == "" {
		return values
	}
	for _, value := range values {
		if value == next {
			return values
		}
	}
	return append(values, next)
}

func appendUniqueStrings(values []string, nextValues ...string) []string {
	for _, next := range nextValues {
		values = appendUniqueString(values, next)
	}
	return values
}

func containsString(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

func nonEmptyString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
