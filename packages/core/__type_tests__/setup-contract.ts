import { expectTypeOf } from 'vitest'
import {
  createSetupPlanner,
  defineSetupContributor,
  type SetupContributor,
  type SetupFinding,
} from '@use-crux/core/setup'

const contributor = defineSetupContributor({
  id: 'runtime',
  inspect: async () => [],
  plan: async () => [],
})
expectTypeOf(contributor.id).toEqualTypeOf<'runtime'>()
expectTypeOf(contributor).toMatchTypeOf<SetupContributor>()
expectTypeOf(createSetupPlanner([contributor]).check).toBeFunction()

const finding: SetupFinding = {
  contributorId: 'runtime', code: 'OK', resource: 'runtime', severity: 'info', message: 'ready',
}
void finding

const documentedFinding = {
  contributorId: 'runtime', code: 'DOCS', resource: 'runtime', severity: 'info', message: 'documented', docsUrl: 'https://cruxjs.dev',
} satisfies SetupFinding
expectTypeOf(documentedFinding.docsUrl).toEqualTypeOf<string>()
