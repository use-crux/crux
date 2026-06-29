package devtools

type memoryBlockInfo struct {
	ID              string `json:"id,omitempty"`
	Kind            string `json:"kind,omitempty"`
	Priority        any    `json:"priority,omitempty"`
	Budget          any    `json:"budget,omitempty"`
	WriteMode       string `json:"writeMode,omitempty"`
	RenderStrategy  string `json:"renderStrategy,omitempty"`
	RenderLimit     any    `json:"renderLimit,omitempty"`
	RetentionPolicy string `json:"retentionPolicy,omitempty"`
	HasEmbed        bool   `json:"hasEmbed,omitempty"`
}

func memoryBlocksFromDefinition(meta map[string]any) []memoryBlockInfo {
	values, ok := meta["blocks"].([]any)
	if !ok {
		return nil
	}
	blocks := make([]memoryBlockInfo, 0, len(values))
	for _, value := range values {
		block := anyMap(value)
		if len(block) == 0 {
			continue
		}
		blocks = append(blocks, memoryBlockInfo{
			ID:              stringValue(block, "id", ""),
			Kind:            stringValue(block, "kind", ""),
			Priority:        optionalMapValue(block, "priority"),
			Budget:          optionalMapValue(block, "budget"),
			WriteMode:       stringValue(block, "writeMode", ""),
			RenderStrategy:  stringValue(block, "renderStrategy", ""),
			RenderLimit:     optionalMapValue(block, "renderLimit"),
			RetentionPolicy: stringValue(block, "retentionPolicy", ""),
			HasEmbed:        boolValue(block, "hasEmbed", false),
		})
	}
	return blocks
}

func optionalMapValue(m map[string]any, key string) any {
	value, ok := m[key]
	if !ok {
		return nil
	}
	return value
}
