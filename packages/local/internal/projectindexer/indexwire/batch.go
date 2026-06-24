package indexwire

func Batch(req Request) ([]any, error) {
	if !shouldChunk(req) {
		return []any{req}, nil
	}
	requestID := NewID(requestIDPrefix(req.Method))
	events := []any{Start(req, requestID)}
	events = appendPreviousIndexBatches(events, req, requestID)
	events = appendSourceProfileBatches(events, req, requestID)
	var err error
	events, err = appendSyntaxRecordBatches(events, req, requestID)
	if err != nil {
		return nil, err
	}
	events = append(events, Request{
		ProtocolVersion: 2,
		Method:          req.Method,
		RequestID:       requestID,
		RequestKind:     RequestKindDone,
	})
	return events, nil
}

func Start(req Request, requestID string) Request {
	start := req
	start.RequestID = requestID
	start.RequestKind = RequestKindStart
	start.PreviousDefinitions = nil
	start.PreviousSources = nil
	start.SyntaxRecords = nil
	start.SyntaxRecordsBatch = nil
	start.SourceProfileFiles = nil
	start.PreviousIndex = CompactPrevious(start.PreviousIndex)
	if start.SourceProfile != nil {
		profile := *start.SourceProfile
		profile.Files = nil
		start.SourceProfile = &profile
	}
	return start
}

func shouldChunk(req Request) bool {
	switch req.Method {
	case "indexProjectAstFromSyntaxRecords":
		return true
	case "indexProjectIncremental", "indexProjectRuntime":
		return HasPreviousRows(req.PreviousIndex)
	case "indexProjectSemantic":
		return HasPreviousRows(req.PreviousIndex) || (req.SourceProfile != nil && len(req.SourceProfile.Files) > 0)
	default:
		return false
	}
}

func appendPreviousIndexBatches(events []any, req Request, requestID string) []any {
	if req.PreviousIndex == nil {
		return events
	}
	for _, batch := range DefinitionBatches(req.PreviousIndex) {
		events = append(events, Request{
			ProtocolVersion:     2,
			Method:              req.Method,
			RequestID:           requestID,
			RequestKind:         RequestKindPreviousDefinitions,
			PreviousDefinitions: batch,
		})
	}
	for _, batch := range SourceBatches(req.PreviousIndex) {
		events = append(events, Request{
			ProtocolVersion: 2,
			Method:          req.Method,
			RequestID:       requestID,
			RequestKind:     RequestKindPreviousSources,
			PreviousSources: batch,
		})
	}
	return events
}

func appendSourceProfileBatches(events []any, req Request, requestID string) []any {
	if req.Method != "indexProjectSemantic" || req.SourceProfile == nil {
		return events
	}
	for _, batch := range Chunk(req.SourceProfile.Files, BatchSize) {
		events = append(events, Request{
			ProtocolVersion:    2,
			Method:             req.Method,
			RequestID:          requestID,
			RequestKind:        RequestKindSourceProfileBatch,
			SourceProfileFiles: batch,
		})
	}
	return events
}

func appendSyntaxRecordBatches(events []any, req Request, requestID string) ([]any, error) {
	if req.Method != "indexProjectAstFromSyntaxRecords" {
		return events, nil
	}
	batches, err := SyntaxRecordBatches(req.SyntaxRecords)
	if err != nil {
		return nil, err
	}
	for _, batch := range batches {
		events = append(events, Request{
			ProtocolVersion:    2,
			Method:             req.Method,
			RequestID:          requestID,
			RequestKind:        RequestKindSyntaxRecords,
			SyntaxRecordsBatch: batch,
		})
	}
	return events, nil
}

func requestIDPrefix(method string) string {
	switch method {
	case "indexProjectSemantic":
		return "semantic"
	case "indexProjectRuntime":
		return "runtime"
	default:
		return "index"
	}
}
