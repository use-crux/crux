import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-fd-foreground">
            <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M12 22V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M2 7l10 5 10-5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <span className="text-[15px] font-bold tracking-[-0.02em]">Crux</span>
        </div>
      ),
    },
    githubUrl: 'https://github.com/anthropics/crux',
    links: [
      {
        text: 'Why Crux',
        url: '/why',
      },
      {
        text: 'Observability',
        url: '/observability',
      },
      {
        text: 'Docs',
        url: '/docs',
        active: 'nested-url',
      },
      {
        text: 'Compare',
        url: '/compare',
      },
    ],
  }
}
