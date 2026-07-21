import { describe, expect, it } from "vitest";
import {
  approvalLoginError,
  canManageRegistrations,
  generateOtp,
  hashOtp,
  normalizeEmail,
  rateLimitResult,
  validateOtp,
  validateRegistrationInput,
} from "../worker/services/registration";

const future = new Date(Date.now() + 60_000).toISOString();

describe("v3 registration", () => {
  it("generates a six-digit OTP", () => expect(generateOtp()).toMatch(/^\d{6}$/));
  it("hashes OTP with stable SHA-256", async () => expect(await hashOtp("123456")).toBe(await hashOtp("123456")));
  it("accepts a correct unexpired OTP", async () => expect(validateOtp({ code_hash: await hashOtp("123456"), expires_at: future, attempts: 0, verified: 0 }, await hashOtp("123456")).ok).toBe(true));
  it("rejects a wrong OTP and requests an attempt increment", async () => expect(validateOtp({ code_hash: await hashOtp("123456"), expires_at: future, attempts: 0, verified: 0 }, await hashOtp("654321"))).toMatchObject({ ok: false, incrementAttempts: true, error: "驗證碼不正確" }));
  it("rejects an expired OTP", async () => expect(validateOtp({ code_hash: await hashOtp("123456"), expires_at: new Date(Date.now() - 1).toISOString(), attempts: 0, verified: 0 }, await hashOtp("123456")).error).toContain("過期"));
  it("rejects an OTP after five attempts", async () => expect(validateOtp({ code_hash: await hashOtp("123456"), expires_at: future, attempts: 5, verified: 0 }, await hashOtp("123456")).error).toContain("上限"));
  it("normalizes email to lowercase", () => expect(normalizeEmail(" Staff@UIC-AI.COM ")).toBe("staff@uic-ai.com"));
  it("blocks registration when disabled", () => expect(validateRegistrationInput({ name: "王小明", email: "staff@example.com", password: "password1", group_id: "grp", code: "123456" }, { enabled: false, emailExists: false, groupExists: true })).toMatchObject({ ok: false, status: 422 }));
  it("blocks a duplicate email with 409", () => expect(validateRegistrationInput({ name: "王小明", email: "staff@example.com", password: "password1", group_id: "grp", code: "123456" }, { enabled: true, emailExists: true, groupExists: true })).toMatchObject({ ok: false, status: 409 }));
  it("blocks a weak password", () => expect(validateRegistrationInput({ name: "王小明", email: "staff@example.com", password: "short", group_id: "grp", code: "123456" }, { enabled: true, emailExists: false, groupExists: true })).toMatchObject({ ok: false, error: "密碼至少 8 碼" }));
  it("blocks an unknown group", () => expect(validateRegistrationInput({ name: "王小明", email: "staff@example.com", password: "password1", group_id: "missing", code: "123456" }, { enabled: true, emailExists: false, groupExists: false })).toMatchObject({ ok: false, error: "所選組別不存在" }));
  it("blocks pending and rejected login but allows approved", () => { expect(approvalLoginError("pending")).toBe("帳號尚未核准"); expect(approvalLoginError("rejected")).toBe("申請未通過"); expect(approvalLoginError("approved")).toBeNull(); });
  it("allows registration administration only for admin", () => { expect(canManageRegistrations("admin")).toBe(true); expect(canManageRegistrations("member")).toBe(false); expect(canManageRegistrations("intern")).toBe(false); });
  it("enforces an IP count limit", () => { expect(rateLimitResult(9, 10)).toEqual({ allowed: true, nextCount: 10 }); expect(rateLimitResult(10, 10)).toEqual({ allowed: false, nextCount: 11 }); });
});
