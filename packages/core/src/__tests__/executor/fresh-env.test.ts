import { describe, test, expect } from "bun:test";
import { getFreshEnv } from "../../executor/fresh-env.js";

describe("getFreshEnv", () => {
  test("returns an object with standard env variables", () => {
    const env = getFreshEnv();
    expect(env).toBeDefined();
    expect(typeof env).toBe("object");
    expect(env.PATH).toBeDefined();
  });

  test("returns consistent results within cache TTL", () => {
    const env1 = getFreshEnv();
    const env2 = getFreshEnv();
    expect(env1).toBe(env2);
  });
});
