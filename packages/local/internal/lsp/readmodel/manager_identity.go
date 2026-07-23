package readmodel

func (m *Manager) validateRemoteSnapshot(snapshot Snapshot) error {
	result, err := ValidateSnapshot(snapshot, m.options.Root, m.options.Version)
	if err != nil {
		m.handleProbeError(err)
		return err
	}
	if result.VersionSkew {
		m.warnVersionSkew()
	}
	return nil
}
