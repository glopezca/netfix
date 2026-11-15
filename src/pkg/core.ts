/**
 * Core entry for Node/Workers: the union of the `./topology` and `./classroom` subpaths (PUBLIC-API.md §3.1–3.2), not a
 * package subpath itself. Re-exports allowed by P5. Not imported by `ui/main.ts`, so the standalone build is unchanged.
 */
export * from './topology.ts';
export * from './classroom.ts';
