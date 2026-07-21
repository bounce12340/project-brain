import { describe, expect, it } from "vitest";
import { createImportPreview } from "../src/import-preview";

describe("admin import preview", () => {
  it("counts a JSON file payload before import", () => {
    expect(createImportPreview(JSON.stringify({
      projects: [
        { tasks: [{ title: "A" }], progress_updates: [{ content: "done" }, { content: "next" }] },
        { tasks: [{ title: "B" }, { title: "C" }] },
      ],
      reg_entries: [{ title: "rule" }],
    }))).toEqual({ projects: 2, tasks: 3, progress_updates: 2, reg_entries: 1 });
  });

  it("rejects non-array import collections", () => {
    expect(() => createImportPreview('{"projects":{}}')).toThrow("projects 必須是陣列");
    expect(() => createImportPreview('{"reg_entries":{}}')).toThrow("reg_entries 必須是陣列");
  });
});
