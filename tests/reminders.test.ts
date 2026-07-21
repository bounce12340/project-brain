import { describe, expect, it } from "vitest";
import { groupEmailNotifications } from "../worker/services/reminders";

const item = (user: string, email: string, title: string) => ({ user_id: user, email, title, body: "內容", link: "/" });

describe("每日提醒彙整", () => {
  it("同 Email 合併成一封", () => expect(groupEmailNotifications([item("1", "a@test", "A"), item("1", "a@test", "B")])).toHaveLength(1));
  it("不同 Email 分開", () => expect(groupEmailNotifications([item("1", "a@test", "A"), item("2", "b@test", "B")])).toHaveLength(2));
  it("保留所有提醒內容", () => expect(groupEmailNotifications([item("1", "a@test", "A"), item("1", "a@test", "B")])[0].items.map((x) => x.title)).toEqual(["A", "B"]));
  it("空輸入回空陣列", () => expect(groupEmailNotifications([])).toEqual([]));
});
