import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { HELP_TOPICS, type TopicKey } from "../help-topics";
import { useLang } from "../i18n/LangContext";

interface BubblePosition {
  left: number;
  top?: number;
  bottom?: number;
}

export function HelpTip({ topic }: { topic: TopicKey }) {
  const { lang } = useLang();
  const content = HELP_TOPICS[topic][lang];
  const id = `help-tip-${useId().replaceAll(":", "")}`;
  const rootRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<BubblePosition>({ left: 16, top: 48 });

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(320, window.innerWidth - 32);
      const left = Math.max(16, Math.min(window.innerWidth - width - 16, rect.left + rect.width / 2 - width / 2));
      if (window.innerHeight - rect.bottom >= 250) setPosition({ left, top: rect.bottom + 8 });
      else setPosition({ left, bottom: window.innerHeight - rect.top + 8 });
    };
    place();
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !bubbleRef.current?.contains(target)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const openFromPointer = () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    setOpen(true);
  };

  const closeAfterPointer = () => {
    if (document.activeElement === buttonRef.current) return;
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  };

  const bubble = open ? createPortal(<span
    ref={bubbleRef}
    id={id}
    role="tooltip"
    className="help-tip-bubble"
    style={position}
    onPointerEnter={openFromPointer}
    onPointerLeave={closeAfterPointer}
  >
    <span className="help-tip-section"><strong>{lang === "zh" ? "是什麼" : "What it is"}</strong><span>{content.what}</span></span>
    <span className="help-tip-section"><strong>{lang === "zh" ? "填什麼" : "What to enter"}</strong><span>{content.fill}</span></span>
    {content.difference && <span className="help-tip-section"><strong>{lang === "zh" ? "差別" : "How it differs"}</strong><span>{content.difference}</span></span>}
    <Link className="help-tip-link" to={content.href} onClick={() => setOpen(false)}>{content.linkLabel}</Link>
  </span>, document.body) : null;

  return <>
    <span ref={rootRef} className="help-tip"><button
      ref={buttonRef}
      type="button"
      role="button"
      tabIndex={0}
      className="help-tip-trigger"
      aria-label={lang === "zh" ? "顯示欄位說明" : "Show field help"}
      aria-describedby={open ? id : undefined}
      aria-expanded={open}
      onClick={() => setOpen(true)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!rootRef.current?.contains(next) && !bubbleRef.current?.contains(next)) setOpen(false);
      }}
      onPointerEnter={openFromPointer}
      onPointerLeave={closeAfterPointer}
    >?</button></span>
    {bubble}
  </>;
}
