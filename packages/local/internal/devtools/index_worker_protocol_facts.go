package devtools

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
