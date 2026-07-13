// Registers the Phase 7 composition native fixture suite. The fixture module
// declares its own `describe`/`itWithRustOxc` block; importing it here connects
// that established parity fixture to the default `vitest run` discovery.
import './first-party-phase7-composition-native-fixtures'
