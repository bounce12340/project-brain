import { zh } from "./translations";
import { en } from "./translations-en";

/** 中英文放在一起，給測試與檢查工具用；網站本身不要 import 這個檔，否則英文會被打包進首頁。 */
export { zh, en };
export const translations = { zh, en } as const;
