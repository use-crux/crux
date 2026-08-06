package kit

// Pluralize returns a regular English noun with an s suffix unless count is 1.
func Pluralize(count int, noun string) string {
	if count == 1 {
		return noun
	}
	return noun + "s"
}
