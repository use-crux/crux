import type { CruxAttributes, CruxGraphRecord } from './contract'
import { PAYLOAD_ATTRIBUTE_KEYS } from './capture-policy-contract'

/** Remove known payload-bearing attributes without mutating the input object. */
export function stripPayloadAttributes(attributes: CruxAttributes | undefined): CruxAttributes | undefined {
  if (!attributes) return undefined
  const nextEntries = Object.entries(attributes).filter(([key]) => !isPayloadAttributeKey(key))
  return nextEntries.length > 0 ? Object.fromEntries(nextEntries) : undefined
}

export function stripRecordPayloadAttributes(record: CruxGraphRecord): CruxGraphRecord {
  if (!('attributes' in record) || record.attributes === undefined) return record
  const attributes = stripPayloadAttributes(record.attributes)
  if (attributes) return { ...record, attributes } as CruxGraphRecord

  const { attributes: _attributes, ...rest } = record
  return rest as CruxGraphRecord
}

function isPayloadAttributeKey(key: string): boolean {
  return (PAYLOAD_ATTRIBUTE_KEYS as readonly string[]).includes(key)
}
