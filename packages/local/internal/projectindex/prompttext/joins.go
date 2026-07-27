package prompttext

import (
	"fmt"
	"math"
	"unicode/utf8"

	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func encodeJoins(
	documentFile string,
	documentSourceHash string,
	joins []FragmentJoin,
	fragments map[string]Fragment,
	initialBytes uint64,
	maxBytes uint32,
) ([]encodedJoin, error) {
	encoded := make([]encodedJoin, 0, len(joins))
	seenKeys := make(map[string]struct{}, len(joins))
	total := initialBytes
	for _, join := range joins {
		key, record, err := encodeJoin(join, documentFile, documentSourceHash, fragments)
		if err != nil {
			return nil, err
		}
		identity := string(key)
		if _, duplicate := seenKeys[identity]; duplicate {
			return nil, fmt.Errorf("PromptText fragment-join key is duplicated")
		}
		seenKeys[identity] = struct{}{}
		total, err = addEvidenceBytes(total, len(record), maxBytes)
		if err != nil {
			return nil, err
		}
		encoded = append(encoded, encodedJoin{join: join, key: key, record: record})
	}
	return encoded, nil
}

func encodeJoin(
	join FragmentJoin,
	documentFile string,
	documentSourceHash string,
	fragments map[string]Fragment,
) ([]byte, []byte, error) {
	if _, targetOK := fragments[join.FragmentID]; !targetOK {
		return nil, nil, fmt.Errorf(
			"PromptText fragment join targets unknown ID %q",
			join.FragmentID,
		)
	}
	if join.Proof != staticprotocol.PromptTextProofSemanticExact {
		return nil, nil, fmt.Errorf("PromptText fragment join has invalid proof %q", join.Proof)
	}
	key := join.Key
	if !canonicalFile(key.File) || !canonicalSourceHash(key.SourceHash) ||
		!validNonemptyRange(key.TemplateRange) ||
		!validNonemptyRange(key.ExpressionRange) ||
		!rangeContains(key.TemplateRange, key.ExpressionRange) {
		return nil, nil, fmt.Errorf("PromptText fragment join has invalid owner key")
	}
	if !joinOwnerKnown(key, documentFile, documentSourceHash, fragments) {
		return nil, nil, fmt.Errorf("PromptText fragment join has unknown owner")
	}
	for _, value := range [...]string{key.File, key.SourceHash, join.FragmentID} {
		if !utf8.ValidString(value) || uint64(len(value)) > math.MaxUint32 {
			return nil, nil, fmt.Errorf("PromptText fragment join contains an invalid string")
		}
	}

	keyRecord := make([]byte, 0)
	keyRecord = appendString(keyRecord, key.File)
	keyRecord = appendString(keyRecord, key.SourceHash)
	keyRecord = appendRange(keyRecord, key.TemplateRange)
	keyRecord = appendUint32(keyRecord, key.Interpolation)
	keyRecord = appendRange(keyRecord, key.ExpressionRange)
	record := append([]byte(nil), keyRecord...)
	record = appendString(record, join.FragmentID)
	record = append(record, 1)
	return keyRecord, record, nil
}

func joinOwnerKnown(
	key staticprotocol.PromptTextInterpolationJoinKey,
	documentFile string,
	documentSourceHash string,
	fragments map[string]Fragment,
) bool {
	if key.File == documentFile && key.SourceHash == documentSourceHash {
		return true
	}
	for _, fragment := range fragments {
		if fragment.File == key.File && fragment.SourceHash == key.SourceHash &&
			fragment.Range == key.TemplateRange {
			return true
		}
	}
	return false
}

func appendRange(target []byte, value staticprotocol.PromptTextRange) []byte {
	target = appendUint32(target, value.Start.Line)
	target = appendUint32(target, value.Start.Character)
	target = appendUint32(target, value.End.Line)
	return appendUint32(target, value.End.Character)
}

func validNonemptyRange(value staticprotocol.PromptTextRange) bool {
	return validRange(value) && value.Start != value.End
}

func rangeContains(
	outer staticprotocol.PromptTextRange,
	inner staticprotocol.PromptTextRange,
) bool {
	return comparePosition(outer.Start, inner.Start) <= 0 &&
		comparePosition(inner.End, outer.End) <= 0
}

func comparePosition(
	left staticprotocol.PromptTextPosition,
	right staticprotocol.PromptTextPosition,
) int {
	if left.Line < right.Line ||
		left.Line == right.Line && left.Character < right.Character {
		return -1
	}
	if left == right {
		return 0
	}
	return 1
}
