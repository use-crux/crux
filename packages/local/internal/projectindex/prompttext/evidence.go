package prompttext

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"sort"

	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

const previewEvidenceDomain = "crux-prompt-text-preview-evidence-v1\x00"

type encodedJoin struct {
	join   FragmentJoin
	key    []byte
	record []byte
}

// CanonicalizePreviewEvidence validates, sorts, and identifies the exact
// fragment and semantic-join vectors sent to the transient compiler.
//
// The combined byte budget is validated before sorting or hashing. The
// returned digest is private coordinator identity and must not be reused as a
// semantic source-profile or compiler-cache identity.
func CanonicalizePreviewEvidence(
	documentFile string,
	documentSourceHash string,
	fragments []Fragment,
	joins []FragmentJoin,
	limits staticprotocol.PromptTextLimits,
) ([]Fragment, []FragmentJoin, [sha256.Size]byte, error) {
	if !canonicalFile(documentFile) || !canonicalSourceHash(documentSourceHash) {
		return nil, nil, [sha256.Size]byte{}, fmt.Errorf(
			"PromptText document has noncanonical preview-evidence identity",
		)
	}
	if uint64(len(fragments)) > uint64(limits.MaxFragments) {
		return nil, nil, [sha256.Size]byte{}, fmt.Errorf(
			"PromptText fragment count exceeds %d",
			limits.MaxFragments,
		)
	}
	if uint64(len(joins)) > uint64(limits.MaxFragmentJoins) {
		return nil, nil, [sha256.Size]byte{}, fmt.Errorf(
			"PromptText fragment-join count exceeds %d",
			limits.MaxFragmentJoins,
		)
	}

	encodedFragments, fragmentsByID, evidenceBytes, err :=
		encodeFragments(fragments, limits.MaxFragmentBytes)
	if err != nil {
		return nil, nil, [sha256.Size]byte{}, err
	}
	encodedJoins, err := encodeJoins(
		documentFile,
		documentSourceHash,
		joins,
		fragmentsByID,
		evidenceBytes,
		limits.MaxFragmentBytes,
	)
	if err != nil {
		return nil, nil, [sha256.Size]byte{}, err
	}

	sort.Slice(encodedFragments, func(left, right int) bool {
		return bytes.Compare(encodedFragments[left].record, encodedFragments[right].record) < 0
	})
	sort.Slice(encodedJoins, func(left, right int) bool {
		return bytes.Compare(encodedJoins[left].record, encodedJoins[right].record) < 0
	})

	stream := make([]byte, 0, len(previewEvidenceDomain)+8)
	stream = append(stream, previewEvidenceDomain...)
	stream = appendUint32(stream, uint32(len(encodedFragments)))
	canonicalFragments := make([]Fragment, 0, len(encodedFragments))
	for _, entry := range encodedFragments {
		stream = append(stream, entry.record...)
		canonicalFragments = append(canonicalFragments, entry.fragment)
	}
	stream = appendUint32(stream, uint32(len(encodedJoins)))
	canonicalJoins := make([]FragmentJoin, 0, len(encodedJoins))
	for _, entry := range encodedJoins {
		stream = append(stream, entry.record...)
		canonicalJoins = append(canonicalJoins, entry.join)
	}
	return canonicalFragments, canonicalJoins, sha256.Sum256(stream), nil
}

func encodeFragments(
	fragments []Fragment,
	maxBytes uint32,
) ([]encodedFragment, map[string]Fragment, uint64, error) {
	encoded := make([]encodedFragment, 0, len(fragments))
	byID := make(map[string]Fragment, len(fragments))
	var total uint64
	for _, fragment := range fragments {
		if _, duplicate := byID[fragment.ID]; duplicate {
			return nil, nil, 0, fmt.Errorf(
				"PromptText fragment ID %q is duplicated",
				fragment.ID,
			)
		}
		record, err := encodeFragment(fragment)
		if err != nil {
			return nil, nil, 0, err
		}
		total, err = addEvidenceBytes(total, len(record), maxBytes)
		if err != nil {
			return nil, nil, 0, err
		}
		byID[fragment.ID] = fragment
		encoded = append(encoded, encodedFragment{fragment: fragment, record: record})
	}
	return encoded, byID, total, nil
}

func addEvidenceBytes(current uint64, recordBytes int, limit uint32) (uint64, error) {
	next := current + uint64(recordBytes)
	if next < current || next > uint64(limit) {
		return 0, fmt.Errorf(
			"PromptText preview evidence exceeds %d bytes",
			limit,
		)
	}
	return next, nil
}
