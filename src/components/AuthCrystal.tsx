/** 登入、申請帳號頁封面左上角的艾爾水晶徽記（同網站圖示）。靜態，不再有光暈與脈動。 */
export function AuthCrystal() {
  return (
    <div className="auth-crystal" aria-hidden="true">
      <img className="auth-crystal-svg" src="/favicon.svg" alt="" width={56} height={56} />
    </div>
  );
}
