package prompttext

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
	"path/filepath"
	"unicode/utf8"

	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

type encodedFragment struct {
	fragment Fragment
	record   []byte
}

func encodeFragment(fragment Fragment) ([]byte, error) {
	if fragment.ID == "" || fragment.Symbol == "" ||
		!canonicalFile(fragment.File) || !canonicalSourceHash(fragment.SourceHash) {
		return nil, fmt.Errorf("PromptText fragment %q has noncanonical identity", fragment.ID)
	}
	if !validNonemptyRange(fragment.Range) {
		return nil, fmt.Errorf("PromptText fragment %q has an invalid range", fragment.ID)
	}
	fields := [...]string{
		fragment.ID,
		fragment.Symbol,
		fragment.File,
		fragment.SourceHash,
		fragment.Snippet,
	}
	for _, field := range fields {
		if !utf8.ValidString(field) || uint64(len(field)) > math.MaxUint32 {
			return nil, fmt.Errorf("PromptText fragment %q contains an invalid string", fragment.ID)
		}
	}

	record := make([]byte, 0)
	record = appendString(record, fragment.ID)
	record = appendString(record, fragment.Symbol)
	record = appendString(record, fragment.File)
	record = appendString(record, fragment.SourceHash)
	record = appendUint32(record, fragment.Range.Start.Line)
	record = appendUint32(record, fragment.Range.Start.Character)
	record = appendUint32(record, fragment.Range.End.Line)
	record = appendUint32(record, fragment.Range.End.Character)
	record = appendString(record, fragment.Snippet)
	return record, nil
}

func canonicalFile(file string) bool {
	return filepath.IsAbs(file) && filepath.Clean(file) == file
}

func canonicalSourceHash(hash string) bool {
	if len(hash) != sha256.Size*2 {
		return false
	}
	decoded := make([]byte, sha256.Size)
	if _, err := hex.Decode(decoded, []byte(hash)); err != nil {
		return false
	}
	return hex.EncodeToString(decoded) == hash
}

func validRange(source staticprotocol.PromptTextRange) bool {
	return source.Start.Line < source.End.Line ||
		source.Start.Line == source.End.Line &&
			source.Start.Character <= source.End.Character
}

func appendString(target []byte, value string) []byte {
	target = appendUint32(target, uint32(len(value)))
	return append(target, value...)
}

func appendUint32(target []byte, value uint32) []byte {
	var encoded [4]byte
	binary.BigEndian.PutUint32(encoded[:], value)
	return append(target, encoded[:]...)
}
