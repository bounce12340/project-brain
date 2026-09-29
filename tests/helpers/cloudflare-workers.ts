/** 測試環境沒有 workerd；OAuth 套件只用到 WorkerEntrypoint 當基底類別。 */
export class WorkerEntrypoint<Env = unknown> {
  constructor(public ctx: unknown, public env: Env) {}
}
