import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 捲到附近才放上 children，之前先顯示同樣高度的 placeholder，畫面不會跳動。
 * 用在儀表板最下面的圖表：圖表套件很大，沒捲到那裡就不必下載。
 * 瀏覽器不支援 IntersectionObserver 時直接顯示。
 */
export function WhenVisible({ children, placeholder, margin = "300px" }: { children: ReactNode; placeholder: ReactNode; margin?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (visible || !ref.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: margin });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible, margin]);
  return visible ? <>{children}</> : <div ref={ref}>{placeholder}</div>;
}
