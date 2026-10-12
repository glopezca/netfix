/** What netsim keeps from an Apache configuration. */

export interface ConfReader {
  /** File text (symbolic links followed), or null when it does not exist. */
  read(path: string): string | null;
  /** Files matching a pattern with wildcards in its last component, sorted. */
  glob(pattern: string): string[];
}

export interface DirBlock {
  readonly path: string;
  readonly regex: boolean;
  readonly options: { indexes?: boolean };
  access?: 'granted' | 'denied';
  directoryIndex?: readonly string[];
}

export interface VHost {
  readonly file: string;
  readonly line: number;
  readonly addr: string;
  /** 0 = any port (`<VirtualHost *>`). */
  readonly port: number;
  serverName?: string;
  readonly serverAliases: string[];
  documentRoot?: string;
  readonly aliases: { readonly url: string; readonly path: string }[];
  readonly redirects: { readonly url: string; readonly target: string; readonly status: number }[];
  readonly errorDocs: Record<number, string>;
  readonly directories: DirBlock[];
  directoryIndex?: readonly string[];
}

export interface ApacheConfig {
  readonly listens: { readonly addr?: string; readonly port: number }[];
  readonly modules: Set<string>;
  readonly vhosts: VHost[];
  /** Directives outside any <VirtualHost> (the main server). */
  readonly main: VHost;
  readonly directories: DirBlock[];
  directoryIndex: readonly string[];
  serverName?: string;
  serverTokens: string;
  serverSignature: boolean;
  readonly warnings: string[];
  readonly defines: Set<string>;
}

export function emptyVhost(file: string, line: number, addr = '*', port = 0): VHost {
  return { file, line, addr, port, serverAliases: [], aliases: [], redirects: [], errorDocs: {}, directories: [] };
}
