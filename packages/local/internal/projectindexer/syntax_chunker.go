package projectindexer

import (
	"encoding/json"
	"fmt"
)

type projectIndexSyntaxRecordFlushFunc func([]json.RawMessage) error

type projectIndexSyntaxRecordChunker struct {
	flush       projectIndexSyntaxRecordFlushFunc
	records     []json.RawMessage
	recordBytes int
}

func newProjectIndexSyntaxRecordChunker(flush projectIndexSyntaxRecordFlushFunc) *projectIndexSyntaxRecordChunker {
	return &projectIndexSyntaxRecordChunker{
		flush:   flush,
		records: make([]json.RawMessage, 0, projectIndexSyntaxRecordRequestBatchMaxRecords),
	}
}

func (c *projectIndexSyntaxRecordChunker) Add(record json.RawMessage) error {
	recordBytes := len(record)
	if recordBytes > projectIndexSyntaxRecordRequestBatchMaxBytes {
		return fmt.Errorf("project index syntax record is %d bytes, max %d", recordBytes, projectIndexSyntaxRecordRequestBatchMaxBytes)
	}
	if len(c.records) > 0 &&
		(len(c.records) >= projectIndexSyntaxRecordRequestBatchMaxRecords ||
			c.recordBytes+recordBytes > projectIndexSyntaxRecordRequestBatchMaxBytes) {
		if err := c.Flush(); err != nil {
			return err
		}
	}
	c.records = append(c.records, record)
	c.recordBytes += recordBytes
	return nil
}

func (c *projectIndexSyntaxRecordChunker) Flush() error {
	if c == nil || len(c.records) == 0 {
		return nil
	}
	records := c.records
	c.records = make([]json.RawMessage, 0, projectIndexSyntaxRecordRequestBatchMaxRecords)
	c.recordBytes = 0
	if c.flush == nil {
		return nil
	}
	return c.flush(records)
}
