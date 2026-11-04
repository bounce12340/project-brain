import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

/**
 * migration 0028 重建 reg_entries（當時為了健保署 RSS 放寬 source；健保署網站擋自動抓取，功能已取下，結構保留）。
 * 重建表最怕的是附件關聯跟著 ON DELETE CASCADE 被刪掉，這裡釘住。
 */
describe("migration 0028：reg_entries 重建", () => {
  it("既有條目、TFDA 草稿與附件關聯都保留；之後可以存 nhi_rss", () => {
    const raw = new DatabaseSync(":memory:");
    raw.exec("PRAGMA foreign_keys = ON");
    const dir = new URL("../migrations/", import.meta.url);
    const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    const before = files.filter((name) => name < "0028");
    for (const file of before) raw.exec(readFileSync(new URL(file, dir), "utf8"));
    raw.exec(`INSERT INTO files (id,filename,size,content_type,storage_key,uploaded_by) VALUES ('f1','a.pdf',1,'application/pdf','k','usr_admin');
      INSERT INTO reg_entries (id,entry_date,product_line,title,status,source,source_ref,created_by,file_id) VALUES
        ('r1','2026-10-29','藥品','手動公告','published','manual',NULL,'usr_admin','f1'),
        ('r2','2026-10-30','藥品','TFDA 草稿','draft','tfda_rss','31671',NULL,NULL);
      INSERT INTO reg_entry_files (entry_id,file_id,position) VALUES ('r1','f1',0);`);
    expect(() => raw.exec("INSERT INTO reg_entries (id,entry_date,product_line,title,status,source) VALUES ('x','2026-11-01','藥品','x','draft','nhi_rss')")).toThrow();
    for (const file of files.filter((name) => name >= "0028")) raw.exec(readFileSync(new URL(file, dir), "utf8"));
    expect(raw.prepare("SELECT id,source,source_ref,file_id,created_by FROM reg_entries ORDER BY id").all()).toEqual([
      { id: "r1", source: "manual", source_ref: null, file_id: "f1", created_by: "usr_admin" },
      { id: "r2", source: "tfda_rss", source_ref: "31671", file_id: null, created_by: null },
    ]);
    expect(raw.prepare("SELECT entry_id,file_id,position FROM reg_entry_files").all()).toEqual([{ entry_id: "r1", file_id: "f1", position: 0 }]);
    raw.exec("INSERT INTO reg_entries (id,entry_date,product_line,title,status,source,source_ref) VALUES ('r3','2026-11-01','藥品','健保署公告','draft','nhi_rss','nhi-1')");
    expect(() => raw.exec("INSERT INTO reg_entries (id,entry_date,product_line,title,status,source,source_ref) VALUES ('r4','2026-11-02','藥品','重複','draft','nhi_rss','nhi-1')")).toThrow(/UNIQUE/);
    expect(() => raw.exec("INSERT INTO reg_entries (id,entry_date,product_line,title,status,source) VALUES ('r5','2026-11-01','藥品','健保署公告','draft','manual')")).toThrow(/UNIQUE/);
    // 刪除條目時附件關聯照舊一起刪（ON DELETE CASCADE 仍指向新表）。
    raw.exec("DELETE FROM reg_entries WHERE id='r1'");
    expect(raw.prepare("SELECT COUNT(*) AS n FROM reg_entry_files").get()).toEqual({ n: 0 });
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%backup%' OR name='reg_entries_new'").all()).toEqual([]);
  });
});
