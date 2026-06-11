package qualityfs

import "time"

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

func nonEmptyString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func nowString() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}
