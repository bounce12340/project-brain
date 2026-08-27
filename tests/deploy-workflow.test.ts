import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const deployJob = workflow.slice(workflow.indexOf("  deploy:"));

describe("部署只在該部署的時候跑", () => {
  it("必須等 verify 過了才部署", () => {
    expect(deployJob).toContain("needs: verify");
  });

  it("PR 與非 main 分支一律不部署", () => {
    // 少了任一個條件，fork 的 PR 或功能分支就會打到正式站。
    expect(deployJob).toContain("github.event_name != 'pull_request'");
    expect(deployJob).toContain("github.ref == 'refs/heads/main'");
  });

  it("部署不設 cancel-in-progress，避免上傳到一半被砍", () => {
    const concurrency = deployJob.slice(deployJob.indexOf("concurrency:"));
    expect(concurrency).toMatch(/group:\s*deploy-production/);
    expect(concurrency).toMatch(/cancel-in-progress:\s*false/);
  });
});

describe("部署步驟的順序與把關", () => {
  const order = (needle: string) => deployJob.indexOf(needle);

  it("先套 migration 再部署", () => {
    // 反過來的話，新程式會在欄位還不存在時就開始服務。
    expect(order("migrations apply")).toBeGreaterThan(-1);
    expect(order("migrations apply")).toBeLessThan(order("wrangler deploy"));
  });

  it("build 在 migration 之前，壞掉的程式不會先動到資料庫", () => {
    expect(order("npm run build")).toBeLessThan(order("migrations apply"));
  });

  it("缺 secret 時立刻失敗，不會跑到一半才發現", () => {
    expect(deployJob).toContain("CLOUDFLARE_API_TOKEN");
    expect(deployJob).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(order("缺少 CLOUDFLARE_API_TOKEN")).toBeLessThan(order("npm run build"));
  });

  it("開跑前一次驗完所有權限，不是失敗一次才知道缺一項", () => {
    // 前兩次自動部署各只暴露一個缺的權限，每補一項就得再等一輪 CI。
    const preflight = deployJob.slice(order("user/tokens/verify"), order("npm run build"));
    for (const permission of ["d1/database", "workers/scripts", "workers/routes"]) {
      expect(preflight, permission).toContain(permission);
    }
    // 探到第一個缺的就中斷的話，就退回一輪只驗一項了。
    expect(preflight).toContain("missing=1");
    expect(order("user/tokens/verify")).toBeLessThan(order("migrations apply"));
  });

  it("部署後實際抓正式站比對，不只信 wrangler 的回報", () => {
    expect(order("projects.uic-ai.com")).toBeGreaterThan(order("wrangler deploy"));
    expect(deployJob).toContain("Cache-Control: no-cache");
    expect(deployJob).toMatch(/exit 1/);
  });
});

describe("憑證不落地", () => {
  it("workflow 只透過 secrets 取用，沒有寫死的 token", () => {
    expect(workflow).toContain("${{ secrets.CLOUDFLARE_API_TOKEN }}");
    expect(workflow).not.toMatch(/cfat_[A-Za-z0-9]{10,}/);
  });
});

describe("verify 仍然守著每一個 PR", () => {
  it("PR 一樣會跑 typecheck、測試與 build", () => {
    const verifyJob = workflow.slice(workflow.indexOf("  verify:"), workflow.indexOf("  deploy:"));
    for (const step of ["npm run typecheck", "npm test", "npm run build"]) expect(verifyJob).toContain(step);
    expect(verifyJob).not.toContain("needs:");
  });
});
