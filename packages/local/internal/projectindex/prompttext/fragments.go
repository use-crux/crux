package prompttext

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
	"path/filepath"
	"sort"
	"unicode/utf8"

	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

const fragmentCatalogueDomain = "crux-prompt-text-fragment-catalogue-v1\x00"

type encodedFragment struct {
	fragment Fragment
	record   []byte
}

// CanonicalizeFragments validates, sorts, and identifies the exact fragment
// vector sent to the transient compiler.
//
// MaxFragmentBytes bounds the aggregate encoded records, including their
// length prefixes and positions. The complete budget is checked before the
// vector is sorted or hashed.
//
// The digest is private coordinator identity. It must not be substituted for
// Project Index source-profile or compiler cache identity.
func CanonicalizeFragments(
	fragments []Fragment,
	limits staticprotocol.PromptTextLimits,
) ([]Fragment, [sha256.Size]byte, error) {
	if uint64(len(fragments)) > uint64(limits.MaxFragments) {
		return nil, [sha256.Size]byte{}, fmt.Errorf(
			"PromptText fragment count exceeds %d",
			limits.MaxFragments,
		)
	}
	encoded := make([]encodedFragment, 0, len(fragments))
	seenIDs := make(map[string]struct{}, len(fragments))
	var catalogueBytes uint64
	for _, fragment := range fragments {
		if _, duplicate := seenIDs[fragment.ID]; duplicate {
			return nil, [sha256.Size]byte{}, fmt.Errorf(
				"PromptText fragment ID %q is duplicated",
				fragment.ID,
			)
		}
		seenIDs[fragment.ID] = struct{}{}
		record, err := encodeFragment(fragment)
		if err != nil {
			return nil, [sha256.Size]byte{}, err
		}
		recordBytes := uint64(len(record))
		if recordBytes > uint64(limits.MaxFragmentBytes)-catalogueBytes {
			return nil, [sha256.Size]byte{}, fmt.Errorf(
				"PromptText fragment catalogue exceeds %d bytes",
				limits.MaxFragmentBytes,
			)
		}
		catalogueBytes += recordBytes
		encoded = append(encoded, encodedFragment{fragment: fragment, record: record})
	}
	sort.Slice(encoded, func(left, right int) bool {
		return bytes.Compare(encoded[left].record, encoded[right].record) < 0
	})

	stream := make([]byte, 0, len(fragmentCatalogueDomain)+4)
	stream = append(stream, fragmentCatalogueDomain...)
	stream = appendUint32(stream, uint32(len(encoded)))
	canonical := make([]Fragment, 0, len(encoded))
	for _, entry := range encoded {
		stream = append(stream, entry.record...)
		canonical = append(canonical, entry.fragment)
	}
	return canonical, sha256.Sum256(stream), nil
}

func encodeFragment(fragment Fragment) ([]byte, error) {
	if fragment.ID == "" || fragment.Symbol == "" ||
		!canonicalFile(fragment.File) || !canonicalSourceHash(fragment.SourceHash) {
		return nil, fmt.Errorf("PromptText fragment %q has noncanonical identity", fragment.ID)
	}
	if !validRange(fragment.Range) {
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
