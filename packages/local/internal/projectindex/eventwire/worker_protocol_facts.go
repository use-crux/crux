package eventwire

import (
	"fmt"
)

func (c *ProjectIndexPatchStreamCollector) addEnvelopeFact(tx *projectIndexPatchTransaction, envelope IndexFactEnvelope) error {
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
	if err := validateIndexFactFidelity(envelope); err != nil {
		return err
	}
	if err := validateIndexFactProvenance(envelope); err != nil {
		return err
	}

	if err := addIndexFactEnvelope(&tx.facts, envelope); err != nil {
		return err
	}
	tx.envelopes = append(tx.envelopes, envelope)
	return nil
}

func (c *ProjectIndexPatchStreamCollector) validateProducer(envelope IndexFactEnvelope) error {
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

func validateIndexFactFidelity(envelope IndexFactEnvelope) error {
	switch envelope.Fidelity {
	case "authoritative", "inferred", "best-effort", "runtime-observed":
		return nil
	case "":
		return fmt.Errorf("project index fact %q missing fidelity", envelope.FactID)
	default:
		return fmt.Errorf("project index fact %q has unsupported fidelity %q", envelope.FactID, envelope.Fidelity)
	}
}

func validateIndexFactProvenance(envelope IndexFactEnvelope) error {
	switch envelope.Provenance.Kind {
	case "source":
		if envelope.Provenance.File == "" {
			return fmt.Errorf("project index fact %q source provenance missing file", envelope.FactID)
		}
	case "runtime":
		if envelope.Provenance.Attribute == "" {
			return fmt.Errorf("project index fact %q runtime provenance missing attribute", envelope.FactID)
		}
	case "filesystem":
		if envelope.Provenance.Path == "" || envelope.Provenance.Convention == "" {
			return fmt.Errorf("project index fact %q filesystem provenance missing path or convention", envelope.FactID)
		}
	case "config":
		if envelope.Provenance.Path == "" || envelope.Provenance.Key == "" {
			return fmt.Errorf("project index fact %q config provenance missing path or key", envelope.FactID)
		}
	case "cli":
		if envelope.Provenance.Flag == "" {
			return fmt.Errorf("project index fact %q cli provenance missing flag", envelope.FactID)
		}
	case "":
		return fmt.Errorf("project index fact %q missing provenance", envelope.FactID)
	default:
		return fmt.Errorf("project index fact %q has unsupported provenance kind %q", envelope.FactID, envelope.Provenance.Kind)
	}
	return nil
}
