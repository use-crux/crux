// Package sourcehash owns the canonical source-byte digest representation used
// by Project Index source rows and editor-buffer comparisons.
package sourcehash

import (
	"crypto/sha256"
	"encoding/hex"
)

// Sum returns the lowercase, unprefixed SHA-256 digest used by
// IndexSourceFile.SourceHash. It hashes bytes exactly as supplied, including
// original newline encoding and UTF-8 representation.
func Sum(source []byte) string {
	digest := sha256.Sum256(source)
	return hex.EncodeToString(digest[:])
}
