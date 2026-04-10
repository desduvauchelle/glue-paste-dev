// Vitest mock for bun:sqlite — allows server tests to run under Node.js/Vitest
export class Database {
  constructor(_path?: string) {}
  prepare(_sql: string) { return { run: () => {}, get: () => null, all: () => [] }; }
  exec(_sql: string) {}
  close() {}
}
