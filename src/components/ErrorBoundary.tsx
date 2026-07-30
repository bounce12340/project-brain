import { Component, type ErrorInfo, type ReactNode } from "react";
import { useT } from "../i18n/LangContext";

interface Labels { title: string; hint: string; retry: string }

interface Props { children: ReactNode; resetKey: string; labels: Labels }

interface State { message: string | null }

/**
 * 任一面板拋錯原本會讓整頁空白且不留任何訊息。這裡把錯誤攔在頁面內容層，
 * 讓導覽與其他頁面維持可用，並把錯誤訊息顯示出來以便回報。
 * resetKey 變動（換頁）時清除錯誤狀態，否則一旦出錯會卡住直到重新載入。
 */
class Boundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.message) this.setState({ message: null });
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Page error boundary caught an error", error, info.componentStack);
  }

  render() {
    if (this.state.message === null) return this.props.children;
    return <section className="panel" role="alert" data-error-boundary>
      <h2 className="mb-2 font-bold">{this.props.labels.title}</h2>
      <p className="mb-4 text-sm text-star-dim">{this.props.labels.hint}</p>
      <pre className="mb-4 overflow-x-auto whitespace-pre-wrap break-words border border-nexus-line bg-void p-3 text-xs text-star-dim">{this.state.message}</pre>
      <button className="btn-secondary" onClick={() => this.setState({ message: null })}>{this.props.labels.retry}</button>
    </section>;
  }
}

export function PageErrorBoundary({ children, resetKey }: { children: ReactNode; resetKey: string }) {
  const t = useT();
  return <Boundary resetKey={resetKey} labels={{ title: t("error.boundaryTitle"), hint: t("error.boundaryHint"), retry: t("error.boundaryRetry") }}>{children}</Boundary>;
}
