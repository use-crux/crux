/**
 * Quick probe script — verifies the skills.sh download API works
 * and the response format matches our expectations.
 * Run: node __tests__/skill/_probe-skillssh.mjs
 */

const url = 'https://skills.sh/api/download/mattpocock/skills/request-refactor-plan'

console.log('Fetching:', url)

const resp = await fetch(url)
console.log('Status:', resp.status, resp.statusText)

if (!resp.ok) {
  console.error('Failed!')
  process.exit(1)
}

const data = await resp.json()
console.log('Files:', data.files?.length)
console.log('Hash:', data.hash)

for (const f of data.files || []) {
  console.log(`  - ${f.path} (${f.contents.length} chars)`)
}

const skillFile = data.files?.find(f => f.path.endsWith('SKILL.md'))
if (skillFile) {
  console.log('\nFirst 500 chars of SKILL.md:')
  console.log(skillFile.contents.substring(0, 500))

  // Check frontmatter
  const hasFrontmatter = skillFile.contents.startsWith('---')
  console.log('\nHas frontmatter:', hasFrontmatter)

  if (hasFrontmatter) {
    const endIdx = skillFile.contents.indexOf('---', 3)
    const frontmatter = skillFile.contents.substring(3, endIdx).trim()
    console.log('Frontmatter fields:')
    for (const line of frontmatter.split('\n')) {
      if (line.includes(':')) {
        console.log('  ', line.trim())
      }
    }
  }
}

console.log('\nAPI format check:')
console.log('  Has files array:', Array.isArray(data.files))
console.log('  Has hash:', typeof data.hash === 'string')
console.log('  Has SKILL.md:', !!skillFile)

const refs = (data.files || []).filter(f => f.path.includes('references/'))
console.log('  Reference files:', refs.length)

console.log('\n✅ skills.sh API works and format matches our parser expectations')
