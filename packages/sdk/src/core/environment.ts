/** The part of Node's `process` the SDK reads. */
interface ProcessEnvironment {
  readonly env: Readonly<Record<string, string | undefined>>
}

function isProcessEnvironment(value: unknown): value is ProcessEnvironment {
  return value instanceof Object && 'env' in value && value.env instanceof Object
}

/** Environment variables where the runtime has them (Node, Bun, Deno); nothing in browsers. */
export class Environment {
  static read(name: string): string | undefined {
    if (!('process' in globalThis)) return undefined
    const host = globalThis.process

    return isProcessEnvironment(host) ? host.env[name] || undefined : undefined
  }
}
