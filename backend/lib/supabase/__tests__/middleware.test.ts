import { afterEach, describe, expect, it, vi } from "vitest";
import { isTrustedMutationOrigin } from "../middleware";

describe("isTrustedMutationOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows exact same origins", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(isTrustedMutationOrigin("https://app.example.com", "https://app.example.com")).toBe(true);
  });

  it("allows localhost and 127.0.0.1 on the same development port", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(isTrustedMutationOrigin("http://localhost:3000", "http://127.0.0.1:3000")).toBe(true);
    expect(isTrustedMutationOrigin("http://127.0.0.1:3000", "http://localhost:3000")).toBe(true);
  });

  it("allows localhost and 127.0.0.1 against a 0.0.0.0 development listener on the same port", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(isTrustedMutationOrigin("http://localhost:3000", "http://0.0.0.0:3000")).toBe(true);
    expect(isTrustedMutationOrigin("http://127.0.0.1:3000", "http://0.0.0.0:3000")).toBe(true);
  });

  it("rejects localhost and 127.0.0.1 when development ports differ", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(isTrustedMutationOrigin("http://localhost:3001", "http://127.0.0.1:3000")).toBe(false);
  });

  it("rejects localhost aliases in production unless origins are exact", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(isTrustedMutationOrigin("http://localhost:3000", "http://127.0.0.1:3000")).toBe(false);
  });

  it("rejects non-local cross-site origins", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(isTrustedMutationOrigin("https://evil.example", "http://localhost:3000")).toBe(false);
  });
});
