package syntax

import (
	"bytes"
	"encoding/json"
	"strconv"

	nodeprocess "github.com/use-crux/crux/packages/local/internal/process/node"
)

func RecordBatchRequestLine(method string, requestID string, records []json.RawMessage) nodeprocess.RawJSONLine {
	var buffer bytes.Buffer
	buffer.Grow(128 + totalRawMessageBytes(records))
	buffer.WriteString(`{"protocolVersion":2,"method":`)
	buffer.WriteString(strconv.Quote(method))
	buffer.WriteString(`,"requestId":`)
	buffer.WriteString(strconv.Quote(requestID))
	buffer.WriteString(`,"requestKind":"syntaxRecords","syntaxRecordsBatch":[`)
	for index, record := range records {
		if index > 0 {
			buffer.WriteByte(',')
		}
		buffer.Write(record)
	}
	buffer.WriteString(`]}`)
	return nodeprocess.RawJSONLine(buffer.Bytes())
}

func totalRawMessageBytes(records []json.RawMessage) int {
	total := 0
	for _, record := range records {
		total += len(record)
	}
	return total
}
