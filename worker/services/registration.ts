import { sha256 } from "./crypto";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface VerificationRecord {
  code_hash: string;
  expires_at: string;
  attempts: number;
  verified: number;
}

export interface RegistrationInput {
  name?: string;
  email?: string;
  password?: string;
  group_id?: string;
  code?: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function generateOtp(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(value).padStart(6, "0");
}

export function hashOtp(code: string): Promise<string> {
  return sha256(code);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function validateOtp(
  record: VerificationRecord | null,
  candidateHash: string,
  now = Date.now(),
): { ok: boolean; error?: string; incrementAttempts: boolean } {
  if (!record || record.verified === 1) return { ok: false, error: "驗證碼無效，請重新取得", incrementAttempts: false };
  if (record.attempts >= 5) return { ok: false, error: "驗證次數已達上限，請重新取得驗證碼", incrementAttempts: false };
  if (new Date(record.expires_at).getTime() <= now) return { ok: false, error: "驗證碼已過期，請重新取得", incrementAttempts: false };
  if (!constantTimeEqual(record.code_hash, candidateHash)) return { ok: false, error: "驗證碼不正確", incrementAttempts: true };
  return { ok: true, incrementAttempts: false };
}

export function validateRegistrationInput(
  input: RegistrationInput,
  context: { enabled: boolean; emailExists: boolean; groupExists: boolean },
): { ok: true; value: Required<RegistrationInput> } | { ok: false; status: 409 | 422; error: string } {
  if (!context.enabled) return { ok: false, status: 422, error: "目前未開放自助註冊" };
  const value = {
    name: input.name?.trim() ?? "",
    email: normalizeEmail(input.email ?? ""),
    password: input.password ?? "",
    group_id: input.group_id?.trim() ?? "",
    code: input.code?.trim() ?? "",
  };
  if (!value.name || !isValidEmail(value.email) || !value.group_id || !/^\d{6}$/.test(value.code)) {
    return { ok: false, status: 422, error: "註冊資料不完整或格式不正確" };
  }
  if (value.password.length < 8) return { ok: false, status: 422, error: "密碼至少 8 碼" };
  if (context.emailExists) return { ok: false, status: 409, error: "此 Email 已註冊" };
  if (!context.groupExists) return { ok: false, status: 422, error: "所選組別不存在" };
  return { ok: true, value };
}

export function approvalLoginError(status: ApprovalStatus): string | null {
  if (status === "pending") return "帳號尚未核准";
  if (status === "rejected") return "申請未通過";
  return null;
}

export function rateLimitResult(currentCount: number, limit: number): { allowed: boolean; nextCount: number } {
  return { allowed: currentCount < limit, nextCount: currentCount + 1 };
}

export function canManageRegistrations(role: string): boolean {
  return role === "admin";
}

