import { describe, expect, it } from "vitest";
import { MAX_PLAN_MILESTONES, MAX_PLAN_TASKS, planCount, sanitizePlan } from "../src/ai-plan";

const stages = ["待辦", "進行中", "已完成"];

describe("sanitizePlan：任務", () => {
  it("保留合法的項目，並把階段對回專案真的有的那幾個", () => {
    const plan = sanitizePlan({ tasks: [{ title: "整理 CTD Module 3", stage: "進行中", due_date: "2026-10-15" }] }, stages);
    expect(plan.tasks).toEqual([{ title: "整理 CTD Module 3", stage: "進行中", due_date: "2026-10-15" }]);
  });

  it("階段名對不上時退回第一個階段，而不是原樣送出", () => {
    // 後端會用 422 擋下不屬於這個專案的階段，但那時使用者已經按了確認，看到的是一排失敗。
    expect(sanitizePlan({ tasks: [{ title: "甲", stage: "To Do" }] }, stages).tasks[0].stage).toBe("待辦");
    expect(sanitizePlan({ tasks: [{ title: "甲", stage: "" }] }, stages).tasks[0].stage).toBe("待辦");
    expect(sanitizePlan({ tasks: [{ title: "甲" }] }, stages).tasks[0].stage).toBe("待辦");
  });

  it("階段名部分吻合時對得回去", () => {
    expect(sanitizePlan({ tasks: [{ title: "甲", stage: "進行" }] }, stages).tasks[0].stage).toBe("進行中");
  });

  it("丟掉沒有標題的項目", () => {
    expect(sanitizePlan({ tasks: [{ title: "   ", stage: "待辦" }, { stage: "待辦" }, { title: 42, stage: "待辦" }] }, stages).tasks).toEqual([]);
  });

  it("不合法的日期一律清空，不猜也不丟掉整條", () => {
    const plan = sanitizePlan({ tasks: [
      { title: "甲", stage: "待辦", due_date: "下個月" },
      { title: "乙", stage: "待辦", due_date: "2026-13-45" },
      { title: "丙", stage: "待辦", due_date: "2026/10/15" },
    ] }, stages);
    expect(plan.tasks.map((task) => task.due_date)).toEqual(["", "", ""]);
    expect(plan.tasks).toHaveLength(3);
  });

  it("同標題同階段只留一筆", () => {
    expect(sanitizePlan({ tasks: [{ title: "甲", stage: "待辦" }, { title: "甲", stage: "待辦" }] }, stages).tasks).toHaveLength(1);
    expect(sanitizePlan({ tasks: [{ title: "甲", stage: "待辦" }, { title: "甲", stage: "進行中" }] }, stages).tasks).toHaveLength(2);
  });

  it("壓平標題裡的換行，並截斷過長的內容", () => {
    const plan = sanitizePlan({ tasks: [{ title: `  甲\n\n乙  `, stage: "待辦" }, { title: "長".repeat(500), stage: "待辦" }] }, stages);
    expect(plan.tasks[0].title).toBe("甲 乙");
    expect(plan.tasks[1].title).toHaveLength(200);
  });

  it("超過上限就截斷——模型偶爾會一口氣列出七十條", () => {
    const many = Array.from({ length: 70 }, (_, index) => ({ title: `任務 ${index}`, stage: "待辦" }));
    expect(sanitizePlan({ tasks: many }, stages).tasks).toHaveLength(MAX_PLAN_TASKS);
  });

  it("專案一個階段都沒有時不產生任何任務", () => {
    // 沒有階段就寫不進去（後端必填 stage_id）。
    expect(sanitizePlan({ tasks: [{ title: "甲", stage: "待辦" }] }, []).tasks).toEqual([]);
  });
});

describe("sanitizePlan：里程碑", () => {
  it("保留期間", () => {
    expect(sanitizePlan({ milestones: [{ title: "送件", due_date: "2026-10-01", end_date: "2026-10-31" }] }, stages).milestones)
      .toEqual([{ title: "送件", due_date: "2026-10-01", end_date: "2026-10-31" }]);
  });

  it("結束日早於開始日時只丟掉結束日，保留里程碑", () => {
    const plan = sanitizePlan({ milestones: [{ title: "送件", due_date: "2026-10-31", end_date: "2026-10-01" }] }, stages);
    expect(plan.milestones).toEqual([{ title: "送件", due_date: "2026-10-31", end_date: "" }]);
  });

  it("沒有開始日就不可能有期間", () => {
    expect(sanitizePlan({ milestones: [{ title: "送件", end_date: "2026-10-31" }] }, stages).milestones[0].end_date).toBe("");
  });

  it("同標題同開始日只留一筆——後端對這個組合回 409", () => {
    const raw = { milestones: [{ title: "送件", due_date: "2026-10-01" }, { title: "送件", due_date: "2026-10-01" }, { title: "送件", due_date: "2026-11-01" }] };
    expect(sanitizePlan(raw, stages).milestones).toHaveLength(2);
  });

  it("超過上限就截斷", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ title: `里程碑 ${index}` }));
    expect(sanitizePlan({ milestones: many }, stages).milestones).toHaveLength(MAX_PLAN_MILESTONES);
  });
});

describe("sanitizePlan：壞掉的輸入", () => {
  it("完全不成形的輸入回空計畫，不丟例外", () => {
    for (const raw of [null, undefined, 42, "文字", [], {}, { tasks: "不是陣列", milestones: 7 }]) {
      expect(() => sanitizePlan(raw, stages)).not.toThrow();
      expect(planCount(sanitizePlan(raw, stages))).toBe(0);
    }
  });

  it("陣列裡混著 null 也不會炸", () => {
    const plan = sanitizePlan({ tasks: [null, { title: "甲", stage: "待辦" }, undefined], milestones: [null] }, stages);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.milestones).toEqual([]);
  });
});
