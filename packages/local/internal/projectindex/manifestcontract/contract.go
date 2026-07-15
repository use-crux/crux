// Package manifestcontract parses and verifies immutable Project Index manifests.
package manifestcontract

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"unicode/utf8"
)

const schemaVersion = 1

var (
	manifestIDPattern          = regexp.MustCompile(`^pim_[0-9a-f]{64}$`)
	contractFingerprintPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// DeploymentManifest mirrors the portable TypeScript v1 artifact.
type DeploymentManifest struct {
	SchemaVersion int                `json:"schemaVersion"`
	ProjectID     string             `json:"projectId"`
	ManifestID    string             `json:"manifestId"`
	Content       ManifestContent    `json:"content"`
	Provenance    ManifestProvenance `json:"provenance"`
}

// ManifestContent is the canonical content-addressed manifest payload.
type ManifestContent struct {
	SchemaVersion int                  `json:"schemaVersion"`
	Definitions   []ManifestDefinition `json:"definitions"`
	Relations     []ManifestRelation   `json:"relations"`
}

// ManifestDefinition is one privacy-safe authored definition projection.
type ManifestDefinition struct {
	ID           string                `json:"id"`
	Kind         string                `json:"kind"`
	Name         string                `json:"name"`
	Fidelity     string                `json:"fidelity"`
	Source       *ManifestSource       `json:"source,omitempty"`
	SourceRefs   *[]ManifestSourceRef  `json:"sourceRefs,omitempty"`
	Fingerprints *ManifestFingerprints `json:"fingerprints,omitempty"`
}

// ManifestSourceRef is one privacy-safe supporting source reference.
type ManifestSourceRef struct {
	ID       string         `json:"id"`
	Role     string         `json:"role"`
	Property *string        `json:"property,omitempty"`
	Symbol   *string        `json:"symbol,omitempty"`
	Source   ManifestSource `json:"source"`
	Fidelity string         `json:"fidelity"`
}

// ManifestSource is a sanitized repository-relative source location.
type ManifestSource struct {
	File   string `json:"file"`
	Line   int    `json:"line"`
	Column *int   `json:"column,omitempty"`
}

// ManifestFingerprints contains compiler-owned privacy-safe digests.
type ManifestFingerprints struct {
	Definition *string `json:"definition,omitempty"`
	Contract   *string `json:"contract,omitempty"`
}

// ManifestRelation is one privacy-safe authored relation projection.
type ManifestRelation struct {
	ID       string          `json:"id"`
	Type     string          `json:"type"`
	From     string          `json:"from"`
	To       string          `json:"to"`
	Fidelity string          `json:"fidelity"`
	Source   *ManifestSource `json:"source,omitempty"`
}

// ManifestProvenance records the compiler that emitted the envelope.
type ManifestProvenance struct {
	Producer        string  `json:"producer"`
	ProducerVersion string  `json:"producerVersion"`
	StaticFrontend  string  `json:"staticFrontend"`
	SemanticBackend *string `json:"semanticBackend,omitempty"`
	SemanticStatus  string  `json:"semanticStatus"`
}

// Parse strictly decodes one TypeScript-produced artifact.
func Parse(artifact []byte) (DeploymentManifest, error) {
	if !utf8.Valid(artifact) {
		return DeploymentManifest{}, errors.New("deployment manifest is not valid UTF-8")
	}
	decoder := json.NewDecoder(bytes.NewReader(artifact))
	decoder.DisallowUnknownFields()
	var manifest DeploymentManifest
	if err := decoder.Decode(&manifest); err != nil {
		return DeploymentManifest{}, fmt.Errorf("decode deployment manifest: %w", err)
	}
	if err := requireJSONEOF(decoder); err != nil {
		return DeploymentManifest{}, err
	}
	if err := validate(manifest); err != nil {
		return DeploymentManifest{}, err
	}
	return manifest, nil
}

// Verify recomputes the TypeScript canonical content digest.
func Verify(manifest DeploymentManifest) error {
	if err := validate(manifest); err != nil {
		return err
	}
	canonical, err := canonicalManifestJSON(manifest.Content)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(canonical)
	want := "pim_" + hex.EncodeToString(digest[:])
	if manifest.ManifestID != want {
		return fmt.Errorf("manifest ID integrity mismatch: got %q, want %q", manifest.ManifestID, want)
	}
	return nil
}

func validate(manifest DeploymentManifest) error {
	if manifest.SchemaVersion != schemaVersion || manifest.Content.SchemaVersion != schemaVersion {
		return errors.New("unsupported deployment manifest schema version")
	}
	if !validIdentityText(manifest.ProjectID) {
		return errors.New("invalid deployment manifest project ID")
	}
	if !manifestIDPattern.MatchString(manifest.ManifestID) {
		return errors.New("invalid deployment manifest ID")
	}
	if manifest.Provenance.Producer != "@use-crux/indexer" || manifest.Provenance.ProducerVersion == "" || manifest.Provenance.StaticFrontend == "" {
		return errors.New("invalid deployment manifest provenance")
	}
	if !oneOf(manifest.Provenance.SemanticStatus, "complete", "disabled", "partial") {
		return errors.New("invalid deployment manifest semantic status")
	}
	if manifest.Provenance.SemanticBackend != nil && *manifest.Provenance.SemanticBackend == "" {
		return errors.New("invalid deployment manifest semantic backend")
	}
	if manifest.Content.Definitions == nil || manifest.Content.Relations == nil {
		return errors.New("deployment manifest content arrays are required")
	}
	for index := range manifest.Content.Definitions {
		if err := validateDefinition(&manifest.Content.Definitions[index]); err != nil {
			return fmt.Errorf("definition %d: %w", index, err)
		}
	}
	for index := range manifest.Content.Relations {
		relation := &manifest.Content.Relations[index]
		if !validFidelity(relation.Fidelity) {
			return fmt.Errorf("relation %d is invalid", index)
		}
		if relation.Source != nil && !validSource(*relation.Source) {
			return fmt.Errorf("relation %d has an invalid source", index)
		}
	}
	return nil
}

func validateDefinition(definition *ManifestDefinition) error {
	if !validDefinitionKind(definition.Kind) || !validFidelity(definition.Fidelity) {
		return errors.New("invalid kind or fidelity")
	}
	if definition.Source != nil && !validSource(*definition.Source) {
		return errors.New("invalid source")
	}
	if definition.SourceRefs != nil {
		for index := range *definition.SourceRefs {
			reference := &(*definition.SourceRefs)[index]
			if !validSourceRefRole(reference.Role) || !oneOf(reference.Fidelity, "resolved", "partial") || !validSource(reference.Source) {
				return fmt.Errorf("source reference %d is invalid", index)
			}
			if !validOptionalIdentifier(reference.Property) || !validOptionalIdentifier(reference.Symbol) {
				return fmt.Errorf("source reference %d has an invalid identifier", index)
			}
		}
	}
	if definition.Fingerprints != nil && definition.Fingerprints.Contract != nil && !contractFingerprintPattern.MatchString(*definition.Fingerprints.Contract) {
		return errors.New("invalid contract fingerprint")
	}
	return nil
}

func validSource(source ManifestSource) bool {
	if source.Line < 1 || (source.Column != nil && *source.Column < 1) || source.File == "" || strings.Contains(source.File, `\`) || strings.HasPrefix(source.File, "/") {
		return false
	}
	if len(source.File) >= 2 && ((source.File[0] >= 'A' && source.File[0] <= 'Z') || (source.File[0] >= 'a' && source.File[0] <= 'z')) && source.File[1] == ':' {
		return false
	}
	for _, segment := range strings.Split(source.File, "/") {
		if segment == "" || segment == "." || segment == ".." || hasControlCharacter(segment) {
			return false
		}
	}
	return true
}

func validIdentityText(value string) bool {
	return value == strings.TrimFunc(value, isECMAScriptWhitespace) && len(value) >= 1 && len(value) <= 200 && !hasControlCharacter(value)
}

func isECMAScriptWhitespace(character rune) bool {
	if character >= '\u2000' && character <= '\u200a' {
		return true
	}
	switch character {
	case '\u0009', '\u000a', '\u000b', '\u000c', '\u000d', '\u0020',
		'\u00a0', '\u1680', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff':
		return true
	default:
		return false
	}
}

func validOptionalIdentifier(value *string) bool {
	return value == nil || (len(*value) >= 1 && len(*value) <= 200 && !hasControlCharacter(*value))
}

func hasControlCharacter(value string) bool {
	for _, character := range value {
		if character <= 0x1f || character == 0x7f {
			return true
		}
	}
	return false
}

func validFidelity(value string) bool { return oneOf(value, "resolved", "partial", "error") }

func validSourceRefRole(value string) bool {
	return oneOf(value, "schema", "callback", "handler", "execute", "prompt", "system", "resolver", "validator", "policy", "config", "helper")
}

func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func requireJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("deployment manifest contains trailing JSON")
		}
		return fmt.Errorf("decode deployment manifest trailer: %w", err)
	}
	return nil
}
