import { expectTypeOf } from 'vitest'
import { registry, skill, type Registry, type Skill } from '../skill'

const acme = registry({
  name: 'acme',
  baseUrl: 'https://skills.acme.corp',
})

const fromBuiltInRegistry = skill.fromRegistry('skills.sh:mattpocock/skills/seo-analysis')
const fromCustomRegistryValue = skill.fromRegistry(acme, 'brand-guidelines')

expectTypeOf(fromBuiltInRegistry).toEqualTypeOf<Skill>()
expectTypeOf(fromCustomRegistryValue).toEqualTypeOf<Skill>()

const compatibleRegistry = {
  name: 'compatible',
  baseUrl: 'https://skills.example.com',
} satisfies Registry

skill.fromRegistry(compatibleRegistry, 'voice-and-tone')

// @ts-expect-error Custom registry values require an explicit skill path.
skill.fromRegistry(acme)

// @ts-expect-error Registry-shaped values need at least name and baseUrl.
skill.fromRegistry({ name: 'missing-url' }, 'brand-guidelines')

// @ts-expect-error The string identifier overload does not accept a second path argument.
skill.fromRegistry('acme:brand-guidelines', 'ignored')
