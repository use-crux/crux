package server

import (
	"unicode/utf16"
	"unicode/utf8"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func (b *documentBuffers) Change(
	uri protocol.DocumentURI,
	version int,
	changes []protocol.TextDocumentContentChangeEvent,
) bool {
	ok, _ := b.ApplyChanges(uri, version, changes)
	return ok
}

func (b *documentBuffers) ApplyChanges(
	uri protocol.DocumentURI,
	version int,
	changes []protocol.TextDocumentContentChangeEvent,
) (bool, *documentBufferLimitNotice) {
	b.mu.Lock()
	defer b.mu.Unlock()
	document, ok := b.documents[uri]
	if !ok {
		return false, nil
	}
	if version <= document.snapshot.Version {
		b.invalidateLocked(uri, document, document.snapshot.Version)
		return false, nil
	}
	if len(changes) == 0 || !document.available && changes[0].Range != nil {
		b.invalidateLocked(uri, document, version)
		return false, nil
	}
	text := document.snapshot.Text
	if !document.available {
		text = ""
	}
	text, ok = applyBufferChanges(text, changes)
	if !ok {
		b.invalidateLocked(uri, document, version)
		return false, nil
	}
	nextTotal := b.totalBytes + len(text)
	if document.available {
		nextTotal -= len(document.snapshot.Text)
	}
	if len(text) > b.limits.DocumentBytes || nextTotal > b.limits.ProcessBytes {
		var notice *documentBufferLimitNotice
		if !document.limitTraced {
			notice = b.limitNoticeLocked(uri, len(text), nextTotal)
			document.limitTraced = true
		}
		b.invalidateLocked(uri, document, version)
		return false, notice
	}
	if document.available {
		b.totalBytes -= len(document.snapshot.Text)
	}
	document.snapshot.Version = version
	document.snapshot.Text = text
	document.available = true
	document.limitTraced = false
	b.documents[uri] = document
	b.totalBytes += len(text)
	return true, nil
}

func (b *documentBuffers) invalidateLocked(
	uri protocol.DocumentURI,
	document bufferDocument,
	version int,
) {
	b.removeBytesLocked(document)
	document.snapshot.Version = version
	document.snapshot.Text = ""
	document.available = false
	b.documents[uri] = document
}

func applyBufferChanges(
	text string,
	changes []protocol.TextDocumentContentChangeEvent,
) (string, bool) {
	current := text
	for _, change := range changes {
		if change.Range == nil {
			current = change.Text
			continue
		}
		start, ok := utf16ByteOffset(current, change.Range.Start)
		if !ok {
			return "", false
		}
		end, ok := utf16ByteOffset(current, change.Range.End)
		if !ok || end < start {
			return "", false
		}
		if change.RangeLength != nil && utf16Length(current[start:end]) != *change.RangeLength {
			return "", false
		}
		current = current[:start] + change.Text + current[end:]
	}
	return current, true
}

func utf16ByteOffset(text string, position protocol.Position) (int, bool) {
	lineStart := 0
	for line := uint32(0); line < position.Line; line++ {
		next := indexByteFrom(text, '\n', lineStart)
		if next < 0 {
			return 0, false
		}
		lineStart = next + 1
	}
	lineEnd := indexByteFrom(text, '\n', lineStart)
	if lineEnd < 0 {
		lineEnd = len(text)
	} else if lineEnd > lineStart && text[lineEnd-1] == '\r' {
		lineEnd--
	}

	units := uint32(0)
	for offset := lineStart; offset < lineEnd; {
		if units == position.Character {
			return offset, true
		}
		r, size := utf8.DecodeRuneInString(text[offset:lineEnd])
		next := units + uint32(utf16.RuneLen(r))
		if next > position.Character {
			return 0, false
		}
		units = next
		offset += size
	}
	if units == position.Character {
		return lineEnd, true
	}
	return 0, false
}

func indexByteFrom(text string, target byte, start int) int {
	for index := start; index < len(text); index++ {
		if text[index] == target {
			return index
		}
	}
	return -1
}

func utf16Length(text string) uint32 {
	var units uint32
	for _, r := range text {
		units += uint32(utf16.RuneLen(r))
	}
	return units
}
