import defaultMdxComponents from 'fumadocs-ui/mdx'
import * as Twoslash from 'fumadocs-twoslash/ui'
import { Card, Cards } from 'fumadocs-ui/components/card'
import { Callout } from 'fumadocs-ui/components/callout'
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'
import { Step, Steps } from 'fumadocs-ui/components/steps'
import type { MDXComponents } from 'mdx/types'

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...Twoslash,
    Card,
    Cards,
    Callout,
    Tab,
    Tabs,
    Step,
    Steps,
    ...components,
  }
}
