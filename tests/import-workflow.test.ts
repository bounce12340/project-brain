import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/import-production.yml", import.meta.url), "utf8");
const triggers = workflow.slice(workflow.indexOf("on:"), workflow.indexOf("concurrency:"));

describe("正式站匯入只能手動觸發", () => {
  it("除了 workflow_dispatch 沒有任何觸發條件", () => {
    // 多一個 push／schedule，正式資料就會在沒人看著的時候被寫入。
    expect(triggers).toContain("workflow_dispatch:");
    for (const forbidden of ["push:", "pull_request:", "schedule:", "repository_dispatch:"]) {
      expect(triggers, `不該有 ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("要輸入確認字串才會往下走", () => {
    expect(workflow).toContain("import-to-production");
    const gate = workflow.slice(workflow.indexOf("Check the confirmation phrase"));
    expect(gate.slice(0, gate.indexOf("- uses:"))).toContain("exit 1");
  });

  it("確認字串是第一個步驟，不在檢查之前就 checkout 或裝東西", () => {
    const firstStep = workflow.indexOf("- name: Check the confirmation phrase");
    expect(firstStep).toBeGreaterThan(-1);
    expect(firstStep).toBeLessThan(workflow.indexOf("- uses: actions/checkout"));
  });

  it("匯入不設 cancel-in-progress，避免寫到一半被砍", () => {
    const concurrency = workflow.slice(workflow.indexOf("concurrency:"));
    expect(concurrency).toMatch(/group:\s*import-production/);
    expect(concurrency).toMatch(/cancel-in-progress:\s*false/);
  });
});

describe("寫正式資料之前先驗過", () => {
  const order = (needle: string) => workflow.indexOf(needle);

  it("先跑 payload 契約測試，再跑真正的匯入", () => {
    expect(order("tests/import-payload.test.ts")).toBeGreaterThan(-1);
    expect(order("tests/import-payload.test.ts")).toBeLessThan(order("Import into production D1"));
  });

  it("缺 secret 或找不到 payload 就早點失敗", () => {
    const guard = workflow.slice(order("Fail fast"), order("Validate the payload"));
    expect(guard).toContain("CLOUDFLARE_API_TOKEN");
    expect(guard).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(guard).toContain("imports/");
  });

  it("預設不允許 owner fallback，要明確勾選才會帶旗標", () => {
    expect(workflow).toMatch(/allow_owner_fallback:[\s\S]*?default:\s*false/);
    expect(workflow).toContain("--allow-owner-fallback");
  });
});
