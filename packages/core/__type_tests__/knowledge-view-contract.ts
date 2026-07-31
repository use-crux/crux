/** Public inference contract for connected knowledge view predicates. */

import { expectTypeOf } from 'vitest'
import type { ViewWhere, WhereClause } from '../src/knowledge/view/where'

interface Metadata {
  readonly status: 'open' | 'closed'
  readonly team?: string
  readonly priority: number
  readonly published: boolean
  readonly tags: readonly string[]
  readonly nested: { readonly owner: string }
}

const exact: WhereClause<Metadata> = {
  status: 'open',
  priority: 2,
  published: true,
}

const inValues = {
  status: ['open', 'closed'],
  team: ['docs', 'core'],
} satisfies ViewWhere<Metadata>

const anyUnion = {
  any: [
    { status: 'open', team: 'docs' },
    { priority: [1, 2], published: false },
  ],
} satisfies ViewWhere<Metadata>

expectTypeOf(exact).toEqualTypeOf<WhereClause<Metadata>>()
expectTypeOf(inValues).toMatchTypeOf<ViewWhere<Metadata>>()
expectTypeOf(anyUnion).toMatchTypeOf<ViewWhere<Metadata>>()

const invalidArrayField: ViewWhere<Metadata> = {
  // @ts-expect-error - array-valued metadata fields are not scalar view keys.
  tags: ['docs'],
}

const invalidObjectField: ViewWhere<Metadata> = {
  // @ts-expect-error - object-valued metadata fields are not scalar view keys.
  nested: { owner: 'docs' },
}

const invalidUnknownField: ViewWhere<Metadata> = {
  // @ts-expect-error - unknown metadata fields are not view keys.
  missing: 'value',
}

void invalidArrayField
void invalidObjectField
void invalidUnknownField
