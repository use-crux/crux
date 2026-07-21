package mapping

import (
	"os"
	"strings"
	"sync"
	"unicode/utf16"
	"unicode/utf8"
)

// LineIndex caches source lines used for UTF-16 positions and code-action
// indentation. Callers invalidate files on save and relevant index deltas.
type LineIndex struct {
	mu    sync.RWMutex
	lines map[string][]string
}

// NewLineIndex creates an empty source-line cache.
func NewLineIndex() *LineIndex {
	return &LineIndex{lines: make(map[string][]string)}
}

// Invalidate drops one cached file after a save or Project Index delta.
func (i *LineIndex) Invalidate(file string) {
	i.mu.Lock()
	delete(i.lines, file)
	i.mu.Unlock()
}

// UTF16Column converts a 1-based UTF-8 byte column into a zero-based LSP
// UTF-16 character, clamping columns beyond the source line.
func (i *LineIndex) UTF16Column(file string, line, column int) uint32 {
	if column <= 1 {
		return 0
	}
	text, ok := i.line(file, line)
	if !ok {
		return uint32(column - 1)
	}
	byteColumn := column - 1
	if byteColumn > len(text) {
		byteColumn = len(text)
	}
	for byteColumn > 0 && byteColumn < len(text) && !utf8.RuneStart(text[byteColumn]) {
		byteColumn--
	}
	return uint32(len(utf16.Encode([]rune(text[:byteColumn]))))
}

// LeadingWhitespace returns the spaces and tabs before a 1-based source line.
func (i *LineIndex) LeadingWhitespace(file string, line int) string {
	text, ok := i.line(file, line)
	if !ok {
		return ""
	}
	end := 0
	for end < len(text) && (text[end] == ' ' || text[end] == '\t') {
		end++
	}
	return text[:end]
}

func (i *LineIndex) line(file string, line int) (string, bool) {
	if line < 1 {
		return "", false
	}
	i.mu.RLock()
	lines, ok := i.lines[file]
	i.mu.RUnlock()
	if !ok {
		content, err := os.ReadFile(file)
		if err != nil {
			return "", false
		}
		lines = strings.Split(string(content), "\n")
		i.mu.Lock()
		i.lines[file] = lines
		i.mu.Unlock()
	}
	if line > len(lines) {
		return "", false
	}
	return strings.TrimSuffix(lines[line-1], "\r"), true
}
