import { describe, expect, it } from "vitest";
import { hashPassword, randomToken, sha256, verifyPassword } from "../worker/services/crypto";

describe("PBKDF2", () => {
  it("hash/verify 往返成功", async () => { const hash = await hashPassword("Brain-2026!"); expect(await verifyPassword("Brain-2026!", hash)).toBe(true); });
  it("錯誤密碼驗證失敗", async () => { const hash = await hashPassword("Brain-2026!"); expect(await verifyPassword("wrong-pass", hash)).toBe(false); });
  it("格式與參數符合規格", async () => expect(await hashPassword("abcdefgh", new Uint8Array(16))).toMatch(/^pbkdf2\$100000\$[^$]+\$[^$]+$/));
  it("不合法 hash 優雅失敗", async () => expect(await verifyPassword("abcdefgh", "bad-hash")).toBe(false));
  it("session token 為 32-byte base64url", () => expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/));
  it("SHA-256 為穩定 64 位 hex", async () => { expect(await sha256("abc")).toHaveLength(64); expect(await sha256("abc")).toBe(await sha256("abc")); });
});
