// Web globals the Core uses that exist in Node and Workers but not in lib ES2022 (no DOM). Core-only: not in tsconfig.json.
interface TextEncoder { encode(input?: string): Uint8Array }
interface TextDecoder { decode(input?: Uint8Array): string }
declare var TextEncoder: { new (): TextEncoder };
declare var TextDecoder: { new (label?: string, options?: { fatal?: boolean }): TextDecoder };
declare function atob(data: string): string;
declare function btoa(data: string): string;
declare var crypto: { getRandomValues<T extends ArrayBufferView>(array: T): T };
