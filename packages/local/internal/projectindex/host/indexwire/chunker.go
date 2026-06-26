package indexwire

import (
	"encoding/json"
	"fmt"
)

type RecordFlushFunc func([]json.RawMessage) error

type RecordChunker struct {
	flush       RecordFlushFunc
	records     []json.RawMessage
	recordBytes int
}

func NewRecordChunker(flush RecordFlushFunc) *RecordChunker {
	return &RecordChunker{
		flush:   flush,
		records: make([]json.RawMessage, 0, SyntaxRecordBatchMaxRecords),
	}
}

func (c *RecordChunker) Add(record json.RawMessage) error {
	recordBytes := len(record)
	if recordBytes > SyntaxRecordBatchMaxBytes {
		return fmt.Errorf("project index syntax record is %d bytes, max %d", recordBytes, SyntaxRecordBatchMaxBytes)
	}
	if len(c.records) > 0 &&
		(len(c.records) >= SyntaxRecordBatchMaxRecords ||
			c.recordBytes+recordBytes > SyntaxRecordBatchMaxBytes) {
		if err := c.Flush(); err != nil {
			return err
		}
	}
	c.records = append(c.records, record)
	c.recordBytes += recordBytes
	return nil
}

func (c *RecordChunker) Flush() error {
	if c == nil || len(c.records) == 0 {
		return nil
	}
	records := c.records
	c.records = make([]json.RawMessage, 0, SyntaxRecordBatchMaxRecords)
	c.recordBytes = 0
	if c.flush == nil {
		return nil
	}
	return c.flush(records)
}

func SyntaxRecordBatches(records []json.RawMessage) ([][]json.RawMessage, error) {
	if len(records) == 0 {
		return nil, nil
	}

	batches := make([][]json.RawMessage, 0, (len(records)/SyntaxRecordBatchMaxRecords)+1)
	chunker := NewRecordChunker(func(batch []json.RawMessage) error {
		batches = append(batches, append([]json.RawMessage(nil), batch...))
		return nil
	})
	for _, record := range records {
		if err := chunker.Add(record); err != nil {
			return nil, err
		}
	}
	if err := chunker.Flush(); err != nil {
		return nil, err
	}
	return batches, nil
}
