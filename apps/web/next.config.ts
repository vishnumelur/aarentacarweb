import type { NextConfig } from 'next'

const config: NextConfig = {
  // The workspace packages ship raw TypeScript rather than a build artefact, so Next
  // must compile them. Recorded in P1-02-FOLLOW-UPS.md as a known packaging trait.
  transpilePackages: ['@aa/db', '@aa/shared'],
}

export default config
