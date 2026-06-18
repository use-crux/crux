package devtools

import (
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func (c *ProjectIndexPatchStreamCollector) addEnvelopeFact(tx *projectIndexPatchTransaction, envelope projectIndexFactEnvelope) error {
	if envelope.SchemaVersion != 1 {
		return fmt.Errorf("project index fact %q has schemaVersion %d", envelope.FactID, envelope.SchemaVersion)
	}
	if envelope.FactID == "" {
		return fmt.Errorf("project index fact missing factId")
	}
	if envelope.Phase != tx.phase {
		return fmt.Errorf("project index fact %q phase = %s, want %s", envelope.FactID, envelope.Phase, tx.phase)
	}
	if err := c.validateRoot(envelope.ProjectRoot); err != nil {
		return err
	}
	if err := c.validateProducer(envelope); err != nil {
		return err
	}

	switch envelope.Kind {
	case "prompts":
		var fact store.PromptMeta
		if err := decodeFact(envelope, &fact); err != nil {
			return err
		}
		tx.facts.Prompts = append(tx.facts.Prompts, fact)
	case "contexts":
		var fact store.ContextMeta
		if err := decodeFact(envelope, &fact); err != nil {
			return err
		}
		tx.facts.Contexts = append(tx.facts.Contexts, fact)
	case "tools":
		var fact store.ToolMeta
		if err := decodeFact(envelope, &fact); err != nil {
			return err
		}
		tx.facts.Tools = append(tx.facts.Tools, fact)
	case "lint":
		if err := decodeFact(envelope, &tx.facts.Lint); err != nil {
			return err
		}
	case "definitions":
		if err := appendDecodedFact(envelope, &tx.facts.Definitions); err != nil {
			return err
		}
	case "relations":
		if err := appendDecodedFact(envelope, &tx.facts.Relations); err != nil {
			return err
		}
	case "sourceRefs":
		if err := appendDecodedFact(envelope, &tx.facts.SourceRefs); err != nil {
			return err
		}
	case "diagnostics":
		if err := appendDecodedFact(envelope, &tx.facts.Diagnostics); err != nil {
			return err
		}
	case "lintFindings":
		if err := appendDecodedFact(envelope, &tx.facts.LintFindings); err != nil {
			return err
		}
	case "ruleDescriptors":
		if err := appendDecodedFact(envelope, &tx.facts.RuleDescriptors); err != nil {
			return err
		}
	case "sources":
		if err := appendDecodedFact(envelope, &tx.facts.Sources); err != nil {
			return err
		}
	case "sourceGraph":
		if err := decodeFact(envelope, &tx.facts.SourceGraph); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unknown project index fact kind %q", envelope.Kind)
	}
	return nil
}

func (c *ProjectIndexPatchStreamCollector) validateProducer(envelope projectIndexFactEnvelope) error {
	if envelope.Producer.Name == "" {
		return fmt.Errorf("project index fact %q missing producer name", envelope.FactID)
	}
	if envelope.Producer.Version == "" {
		return fmt.Errorf("project index fact %q missing producer version", envelope.FactID)
	}
	if c.options.Producer != "" && envelope.Producer.Name != c.options.Producer {
		return fmt.Errorf("project index fact %q producer = %s, want %s", envelope.FactID, envelope.Producer.Name, c.options.Producer)
	}
	return nil
}

func decodeFact[T any](envelope projectIndexFactEnvelope, out *T) error {
	if len(envelope.Fact) == 0 {
		return fmt.Errorf("project index fact %q missing payload", envelope.FactID)
	}
	if err := json.Unmarshal(envelope.Fact, out); err != nil {
		return fmt.Errorf("decode project index fact %q (%s): %w", envelope.FactID, envelope.Kind, err)
	}
	return nil
}

func appendDecodedFact[T any](envelope projectIndexFactEnvelope, out *[]T) error {
	var fact T
	if err := decodeFact(envelope, &fact); err != nil {
		return err
	}
	*out = append(*out, fact)
	return nil
}
