/** «Acerca de»: version, authorship, licences and attributions, from package.json and LICENSE.md. */
import { ABOUT } from './about-data.ts';
import { markdownBlocks } from './markdown.ts';
import type { DocBlock } from './types.ts';

export interface AboutInfo {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly license: string;
  readonly repository: string;
  readonly author: string;
  /** Base for relative links of LICENSE.md (files of the repository). */
  readonly fileBase: string;
  readonly blocks: readonly DocBlock[];
}

const AUTHOR_LINE = /^\s*-\s*\*\*Autoría:\*\*\s*(.+?)\s*$/m;

export function aboutInfo(): AboutInfo {
  const author = AUTHOR_LINE.exec(ABOUT.licenseMarkdown)?.[1] ?? '';
  return {
    name: ABOUT.name.charAt(0).toUpperCase() + ABOUT.name.slice(1),
    version: ABOUT.version,
    description: ABOUT.description,
    license: ABOUT.license,
    repository: ABOUT.repository,
    author,
    fileBase: `${ABOUT.repository}/blob/main/`,
    blocks: markdownBlocks(ABOUT.licenseMarkdown),
  };
}
