package devtools

import (
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/store"
)

// IndexFactProducer identifies the worker or backend that emitted a fact.
type IndexFactProducer struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// IndexFactProvenance records the JSON-safe source of a streamed fact.
//
// The shape intentionally mirrors the public Project Model provenance union
// without forcing every local read model to understand provenance internals.
type IndexFactProvenance struct {
	Kind       string `json:"kind"`
	File       string `json:"file,omitempty"`
	ExportName string `json:"exportName,omitempty"`
	TraceID    string `json:"traceId,omitempty"`
	Attribute  string `json:"attribute,omitempty"`
	Path       string `json:"path,omitempty"`
	Convention string `json:"convention,omitempty"`
	Key        string `json:"key,omitempty"`
	Flag       string `json:"flag,omitempty"`
}

// IndexFactEnvelope is the durable Go representation of a V2 worker fact.
//
// The envelope intentionally stores the JSON payload beside provenance and
// phase metadata. Projection can decode the fact into the compatibility read
// model, while storage can index the envelope without knowing every fact kind.
type IndexFactEnvelope struct {
	SchemaVersion int                 `json:"schemaVersion"`
	FactID        string              `json:"factId"`
	Kind          string              `json:"kind"`
	Phase         IndexPatchPhase     `json:"phase"`
	ProjectRoot   string              `json:"projectRoot"`
	Producer      IndexFactProducer   `json:"producer"`
	Fidelity      string              `json:"fidelity"`
	Provenance    IndexFactProvenance `json:"provenance"`
	Fact          json.RawMessage     `json:"fact"`
}

// IndexFactTransaction is one validated Project Index phase commit.
type IndexFactTransaction struct {
	Patch IndexPatch
	Facts []IndexFactEnvelope
}

var fallbackIndexFactProducer = IndexFactProducer{
	Name:    "@crux/local/project-index",
	Version: "v2",
}

func indexFactTransactionFromPatch(patch IndexPatch) IndexFactTransaction {
	if len(patch.FactEnvelopes) > 0 {
		return IndexFactTransaction{Patch: patch, Facts: append([]IndexFactEnvelope(nil), patch.FactEnvelopes...)}
	}
	return IndexFactTransaction{Patch: patch, Facts: indexFactEnvelopesFromPatch(patch, fallbackIndexFactProducer)}
}

func indexFactEnvelopesFromPatch(patch IndexPatch, producer IndexFactProducer) []IndexFactEnvelope {
	facts := []IndexFactEnvelope{}
	facts = appendPatchFactList(facts, patch, producer, "prompts", patch.Facts.Prompts)
	facts = appendPatchFactList(facts, patch, producer, "contexts", patch.Facts.Contexts)
	facts = appendPatchFactList(facts, patch, producer, "tools", patch.Facts.Tools)
	if patch.Facts.Lint != nil {
		facts = appendPatchFact(facts, patch, producer, "lint", patch.Facts.Lint, 0)
	}
	facts = appendPatchFactList(facts, patch, producer, "definitions", patch.Facts.Definitions)
	facts = appendPatchFactList(facts, patch, producer, "relations", patch.Facts.Relations)
	facts = appendPatchFactList(facts, patch, producer, "sourceRefs", patch.Facts.SourceRefs)
	facts = appendPatchFactList(facts, patch, producer, "diagnostics", patch.Facts.Diagnostics)
	facts = appendPatchFactList(facts, patch, producer, "lintFindings", patch.Facts.LintFindings)
	facts = appendPatchFactList(facts, patch, producer, "ruleDescriptors", patch.Facts.RuleDescriptors)
	facts = appendPatchFactList(facts, patch, producer, "sources", patch.Facts.Sources)
	if patch.Facts.SourceGraph != nil {
		facts = appendPatchFact(facts, patch, producer, "sourceGraph", patch.Facts.SourceGraph, 0)
	}
	return facts
}

func appendPatchFactList[T any](facts []IndexFactEnvelope, patch IndexPatch, producer IndexFactProducer, kind string, values []T) []IndexFactEnvelope {
	for index, value := range values {
		facts = appendPatchFact(facts, patch, producer, kind, value, index)
	}
	return facts
}

func appendPatchFact(facts []IndexFactEnvelope, patch IndexPatch, producer IndexFactProducer, kind string, value any, index int) []IndexFactEnvelope {
	payload, err := json.Marshal(value)
	if err != nil {
		return facts
	}
	return append(facts, IndexFactEnvelope{
		SchemaVersion: 1,
		FactID:        indexPatchFactID(kind, value, index),
		Kind:          kind,
		Phase:         patch.Phase,
		ProjectRoot:   patch.Project.Root,
		Producer:      producer,
		Fidelity:      indexFactFidelityForPhase(patch.Phase),
		Provenance:    indexFactProvenanceForPhase(patch.Phase),
		Fact:          payload,
	})
}

func indexFactFidelityForPhase(phase IndexPatchPhase) string {
	if phase == indexPatchPhaseRuntime {
		return "runtime-observed"
	}
	return "inferred"
}

func indexFactProvenanceForPhase(phase IndexPatchPhase) IndexFactProvenance {
	if phase == indexPatchPhaseRuntime {
		return IndexFactProvenance{Kind: "runtime", Attribute: "project-index.runtime"}
	}
	return IndexFactProvenance{Kind: "runtime", Attribute: "project-index." + string(phase)}
}

func indexPatchFactID(kind string, fact any, index int) string {
	if id := indexPatchFactStableID(fact); id != "" {
		return kind + ":" + id
	}
	return fmt.Sprintf("%s:%d", kind, index)
}

func indexPatchFactStableID(fact any) string {
	switch value := fact.(type) {
	case store.PromptMeta:
		return value.ID
	case store.ContextMeta:
		return value.ID
	case store.ToolMeta:
		return value.Name
	case store.ProjectDefinition:
		return value.ID
	case store.ProjectRelation:
		return relationMergeKey(value)
	case IndexSourceRefFact:
		return value.DefinitionID + ":" + value.Ref.ID
	case store.IndexDiagnostic:
		return value.ID
	case store.IndexLintFinding:
		return value.ID
	case store.IndexRuleDescriptor:
		return value.ID
	case store.IndexSourceFile:
		return value.File
	}

	data, err := json.Marshal(fact)
	if err != nil {
		return ""
	}
	var record map[string]any
	if err := json.Unmarshal(data, &record); err != nil {
		return ""
	}
	for _, key := range []string{"id", "file", "name", "ruleId", "ruleID"} {
		if value, ok := record[key].(string); ok && value != "" {
			return value
		}
	}
	return ""
}

func indexPatchFactsFromEnvelopes(envelopes []IndexFactEnvelope) (IndexPatchFacts, error) {
	facts := IndexPatchFacts{}
	for _, envelope := range envelopes {
		if err := addIndexFactEnvelope(&facts, envelope); err != nil {
			return IndexPatchFacts{}, err
		}
	}
	return facts, nil
}

func addIndexFactEnvelope(facts *IndexPatchFacts, envelope IndexFactEnvelope) error {
	switch envelope.Kind {
	case "prompts":
		return appendDecodedIndexFact(envelope, &facts.Prompts)
	case "contexts":
		return appendDecodedIndexFact(envelope, &facts.Contexts)
	case "tools":
		return appendDecodedIndexFact(envelope, &facts.Tools)
	case "lint":
		return decodeIndexFact(envelope, &facts.Lint)
	case "definitions":
		return appendDecodedIndexFact(envelope, &facts.Definitions)
	case "relations":
		return appendDecodedIndexFact(envelope, &facts.Relations)
	case "sourceRefs":
		return appendDecodedIndexFact(envelope, &facts.SourceRefs)
	case "diagnostics":
		return appendDecodedIndexFact(envelope, &facts.Diagnostics)
	case "lintFindings":
		return appendDecodedIndexFact(envelope, &facts.LintFindings)
	case "ruleDescriptors":
		return appendDecodedIndexFact(envelope, &facts.RuleDescriptors)
	case "sources":
		return appendDecodedIndexFact(envelope, &facts.Sources)
	case "sourceGraph":
		return decodeIndexFact(envelope, &facts.SourceGraph)
	default:
		return fmt.Errorf("unknown project index fact kind %q", envelope.Kind)
	}
}

func decodeIndexFact[T any](envelope IndexFactEnvelope, out *T) error {
	if len(envelope.Fact) == 0 {
		return fmt.Errorf("project index fact %q missing payload", envelope.FactID)
	}
	if err := json.Unmarshal(envelope.Fact, out); err != nil {
		return fmt.Errorf("decode project index fact %q (%s): %w", envelope.FactID, envelope.Kind, err)
	}
	return nil
}

func appendDecodedIndexFact[T any](envelope IndexFactEnvelope, out *[]T) error {
	var fact T
	if err := decodeIndexFact(envelope, &fact); err != nil {
		return err
	}
	*out = append(*out, fact)
	return nil
}
