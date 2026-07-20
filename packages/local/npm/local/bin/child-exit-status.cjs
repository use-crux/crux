const signalExitCodes = {
  SIGINT: 130,
  SIGTERM: 143,
}

module.exports = function childExitStatus(result) {
  if (Number.isInteger(result.status)) return result.status
  return signalExitCodes[result.signal] ?? 1
}
