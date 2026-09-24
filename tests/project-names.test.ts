import { describe, expect, it } from "vitest";
import { closestProjectName, normalizeProjectName } from "../src/project-names";

describe("專案名稱比對不分全形半形與空白", () => {
  it("正式站的專案名稱是全形冒號，表上常打半形", () => {
    expect(normalizeProjectName("QA:GDP/GMP")).toBe(normalizeProjectName("QA：GDP/GMP"));
    expect(normalizeProjectName("RA：啟動 Plenvu 註冊")).toBe(normalizeProjectName("RA:啟動Plenvu註冊"));
    expect(normalizeProjectName(" ＱＡ：ＧＤＰ／ＧＭＰ ")).toBe(normalizeProjectName("qa:gdp/gmp"));
  });

  it("不同的名稱不會被當成同一個", () => {
    expect(normalizeProjectName("QA：GDP/GMP")).not.toBe(normalizeProjectName("QA：一般事務"));
  });
});

describe("對不到時提示最接近的專案", () => {
  const names = ["QA：GDP/GMP", "QA：一般事務", "QA：財務部作業", "RA：啟動Plenvu註冊"];

  it("少打了前綴", () => expect(closestProjectName("GDP/GMP", names)).toBe("QA：GDP/GMP"));
  it("打錯一兩個字", () => expect(closestProjectName("QA：財物部作業", names)).toBe("QA：財務部作業"));
  it("差太多就不亂猜", () => expect(closestProjectName("預算管理", names)).toBeNull());
  it("空字串與空清單", () => {
    expect(closestProjectName("", names)).toBeNull();
    expect(closestProjectName("GDP", [])).toBeNull();
  });
});
