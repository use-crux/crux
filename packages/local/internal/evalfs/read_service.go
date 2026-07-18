package evalfs

import "encoding/json"

// ReadRun returns exact bytes through the local read-service contract.
func (s *Store) ReadRunRaw(runID string) (json.RawMessage, bool, error) {
	run, found, err := s.ReadRun(runID)
	if err != nil || !found {
		return nil, found, err
	}
	return run.Raw, true, nil
}
