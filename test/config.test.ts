import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const required = {
  DATABASE_URL: "postgres://localhost/psqc",
  ACTIONPACKD_API_KEY: "apk_test_x",
  ACTIONPACKD_WEBHOOK_SECRET: "secret",
};

describe("loadConfig", () => {
  it("applies defaults for port and the Actionpackd base URL", () => {
    const config = loadConfig(required);
    expect(config.PORT).toBe(3000);
    expect(config.ACTIONPACKD_BASE_URL).toBe("https://api.actionpackd.com/v1");
    expect(config.NODE_ENV).toBe("development");
    expect(config.LOG_LEVEL).toBe("info");
  });

  it("names the missing variables", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({})).toThrow(/ACTIONPACKD_API_KEY/);
    expect(() => loadConfig({})).toThrow(/ACTIONPACKD_WEBHOOK_SECRET/);
  });
});
