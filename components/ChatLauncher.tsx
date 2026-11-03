"use client";

// Gate in front of ChatPanel: ChatPanel creates the result's tutoring session
// as soon as it mounts, so it must NOT be mounted until the user explicitly
// asks for it. Call sites key this by result id so switching results collapses
// back to the button.
import { useEffect, useState } from "react";
import ChatPanel from "@/components/ChatPanel";
import { getModel } from "@/lib/models";

interface Props {
  resultId: string;
  modelKey: string;
  accent: string;
}

export default function ChatLauncher(props: Props) {
  const [started, setStarted] = useState(false);
  const [checking, setChecking] = useState(true);
  const model = getModel(props.modelKey);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tutor/session?resultId=${encodeURIComponent(props.resultId)}`)
      .then((res) => {
        if (!cancelled && res.ok) setStarted(true);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.resultId]);

  if (started) return <ChatPanel {...props} />;
  if (checking) return null;

  return (
    <div
      style={{
        marginTop: 16,
        background: "#fffdf7",
        border: "1px solid #e6dcc7",
        borderRadius: 12,
        padding: "16px 22px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: model?.dot, flexShrink: 0 }} />
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 16,
            fontWeight: 600,
            color: "#3a342b",
          }}
        >
          Diskusi Pemahaman
        </span>
        <span style={{ fontSize: 11, color: "#9a8e79" }}>
          — belum dimulai, tidak ada token terpakai
        </span>
      </div>
      <button
        onClick={() => setStarted(true)}
        style={{
          border: "none",
          borderRadius: 9,
          padding: "9px 16px",
          fontSize: 12.5,
          fontWeight: 600,
          color: "#fff",
          background: props.accent,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        Start AI Tutoring Prototype
      </button>
    </div>
  );
}
