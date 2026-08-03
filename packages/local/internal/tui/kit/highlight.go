package kit

import (
	"strings"

	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/use-crux/crux/packages/local/internal/theme"
)

// HighlightCode applies the deliberately small Crux code-token palette. The
// caller must sanitize authored input before passing it here.
func HighlightCode(source, language string, styles theme.Styles) string {
	if source == "" {
		return ""
	}
	lexer := lexers.Get(strings.ToLower(strings.TrimSpace(language)))
	if lexer == nil {
		return styles.Regular.Render(source)
	}
	iterator, err := chroma.Coalesce(lexer).Tokenise(nil, source)
	if err != nil {
		return styles.Regular.Render(source)
	}

	var out strings.Builder
	written := 0
	for token := iterator(); token != chroma.EOF; token = iterator() {
		if written >= len(source) {
			break
		}
		value := token.Value
		if remaining := len(source) - written; len(value) > remaining {
			value = value[:remaining]
		}
		style := styles.Regular
		switch {
		case token.Type.InCategory(chroma.Keyword):
			style = styles.Violet
		case token.Type.InSubCategory(chroma.LiteralString):
			style = styles.Green
		case token.Type.InSubCategory(chroma.LiteralNumber):
			style = styles.Amber
		case token.Type.InCategory(chroma.Comment):
			style = styles.Dim
		case token.Type.InCategory(chroma.Name):
			style = styles.Accent
		}
		out.WriteString(style.Render(value))
		written += len(value)
	}
	return out.String()
}
