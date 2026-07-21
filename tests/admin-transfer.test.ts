import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { adminRoutes } from "../worker/routes/admin";
import type { AppContext, AuthUser } from "../worker/types";
import {
  isActiveApprovedAdmin,
  nextCredentialFailure,
  removesActiveApprovedAdmin,
  shouldBlockAdminMutation,
  successorEligibilityError,
  transferRoleSequence,
  type TransferCandidateState,
} from "../worker/services/admin-transfer";

const account = (role: "admin" | "member" | "intern", patch: Partial<TransferCandidateState> = {}): TransferCandidateState => ({
  id: "usr_target", role, is_active: 1, approval_status: "approved", ...patch,
});

const actor: AuthUser = {
  id: "usr_actor", email: "actor@example.com", name: "Actor", role: "admin", group_id: "grp", group_name: "Group",
  group_type: "general", must_change_password: 0, email_notifications: 1, onboarding_done: 1, approval_status: "approved",
};

function guardTestApp(activeAdminCount: number) {
  const target = { name: "Last", email: "last@example.com", role: "admin", group_id: "grp", is_active: 1, email_notifications: 1, approval_status: "approved" };
  const db = {
    prepare(sql: string) {
      return {
        bind() { return this; },
        async first<T>(column?: string): Promise<T | null> {
          if (sql.includes("COUNT(*)")) return (column ? activeAdminCount : { value: activeAdminCount }) as T;
          return target as T;
        },
        async run() { throw new Error("guarded mutation must not reach UPDATE"); },
      };
    },
  };
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => { c.set("user", actor); c.set("sessionToken", "test"); return next(); });
  app.route("/api/admin", adminRoutes);
  return { app, env: { DB: db } as unknown as Env };
}

describe("v4 admin transfer", () => {
  it("blocks downgrading the last active approved admin", () => expect(shouldBlockAdminMutation(account("admin"), "member", 1, 1)).toBe(true));
  it("blocks deactivating the last active approved admin", () => expect(shouldBlockAdminMutation(account("admin"), "admin", 0, 1)).toBe(true));
  it("allows downgrade when another active approved admin exists", () => expect(shouldBlockAdminMutation(account("admin"), "member", 1, 2)).toBe(false));
  it("does not count pending, inactive, or non-admin accounts as active admins", () => {
    expect(isActiveApprovedAdmin(account("admin", { approval_status: "pending" }))).toBe(false);
    expect(isActiveApprovedAdmin(account("admin", { is_active: 0 }))).toBe(false);
    expect(isActiveApprovedAdmin(account("member"))).toBe(false);
  });
  it("recognizes both downgrade and deactivation as removing an admin", () => {
    expect(removesActiveApprovedAdmin(account("admin"), "member", 1)).toBe(true);
    expect(removesActiveApprovedAdmin(account("admin"), "admin", 0)).toBe(true);
  });
  it("accepts an active approved member or intern as successor", () => {
    expect(successorEligibilityError(account("member"), "usr_current")).toBeNull();
    expect(successorEligibilityError(account("intern"), "usr_current")).toBeNull();
  });
  it("rejects pending, inactive, and existing-admin successors", () => {
    expect(successorEligibilityError(account("member", { approval_status: "pending" }), "usr_current")).toContain("核准");
    expect(successorEligibilityError(account("member", { is_active: 0 }), "usr_current")).toContain("啟用");
    expect(successorEligibilityError(account("admin"), "usr_current")).toContain("尚未擔任");
  });
  it("rejects a missing or self successor", () => {
    expect(successorEligibilityError(null, "usr_current")).not.toBeNull();
    expect(successorEligibilityError(account("member", { id: "usr_current" }), "usr_current")).not.toBeNull();
  });
  it("co-admin promotes only the successor", () => expect(transferRoleSequence("co_admin", "usr_current", "usr_next")).toEqual([{ id: "usr_next", role: "admin" }]));
  it("full transfer orders promotion before current-admin demotion", () => expect(transferRoleSequence("full_transfer", "usr_current", "usr_next")).toEqual([{ id: "usr_next", role: "admin" }, { id: "usr_current", role: "member" }]));
  it("increments the shared credential failure count", () => expect(nextCredentialFailure(2, 0)).toEqual({ failedCount: 3, lockedUntil: null }));
  it("locks for fifteen minutes on the fifth credential failure", () => expect(nextCredentialFailure(4, 0)).toEqual({ failedCount: 0, lockedUntil: new Date(15 * 60_000).toISOString() }));
  it("returns 422 from the PATCH API when downgrading the last admin", async () => {
    const { app, env } = guardTestApp(1);
    const response = await app.request("/api/admin/users/usr_last", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "member" }) }, env);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "系統至少需要一名管理員" });
  });
  it("returns 422 from the deactivate API when deactivating the last admin", async () => {
    const { app, env } = guardTestApp(1);
    const response = await app.request("/api/admin/users/usr_last", { method: "DELETE" }, env);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: "系統至少需要一名管理員" });
  });
});
