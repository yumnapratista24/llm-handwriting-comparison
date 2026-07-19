"use client";

import { useEffect, useRef, useState } from "react";
import { getModel, type GradeResponse } from "@/lib/models";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  resultId: string; // resets the discussion when the selected result changes
  modelKey: string;
  question: string;
  grade: GradeResponse;
  accent: string;
}

export default function ChatPanel({ resultId, modelKey, question, grade, accent }: Props) {
  const model = getModel(modelKey);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startedRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Ask the tutor for the next turn given a conversation history.
  async function runTurn(history: ChatMessage[]) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelKey, question, grade, messages: history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setMessages([...history, { role: "assistant", content: data.reply as string }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat balasan");
    } finally {
      setLoading(false);
    }
  }

  // On (re)selecting a result: reset and auto-post Turn 1. Guard against the
  // React strict-mode double effect so we don't fire two openings.
  useEffect(() => {
    if (startedRef.current === resultId) return;
    startedRef.current = resultId;
    setMessages([]);
    setInput("");
    runTurn([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const send = () => {
    const text = input.trim();
    if (!text || loading) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    runTurn(next);
  };

  return (
    <div
      style={{
        marginTop: 16,
        background: "#fffdf7",
        border: "1px solid #e6dcc7",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* header */}
      <div
        style={{
          padding: "16px 22px",
          borderBottom: "1px solid #efe7d6",
          display: "flex",
          alignItems: "center",
          gap: 9,
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: model?.dot }} />
        <span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600, color: "#3a342b" }}>
          Diskusi Pemahaman
        </span>
        <span style={{ fontSize: 11, color: "#9a8e79" }}>
          — {model?.label} memandu diskusi singkat
        </span>
      </div>

      {/* messages */}
      <div
        ref={scrollRef}
        style={{
          padding: "18px 22px",
          maxHeight: 420,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {messages.map((m, i) => {
          const mine = m.role === "user";
          return (
            <div
              key={i}
              style={{
                alignSelf: mine ? "flex-end" : "flex-start",
                maxWidth: "78%",
                background: mine ? accent : "#fbf7ee",
                color: mine ? "#fff" : "#3a342b",
                border: mine ? "none" : "1px solid #ece2cd",
                borderRadius: 12,
                padding: "10px 13px",
                fontSize: 13,
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
              }}
            >
              {m.content}
            </div>
          );
        })}

        {loading && (
          <div
            style={{
              alignSelf: "flex-start",
              background: "#fbf7ee",
              border: "1px solid #ece2cd",
              borderRadius: 12,
              padding: "10px 13px",
              fontSize: 13,
              color: "#9a8e79",
              fontStyle: "italic",
            }}
          >
            mengetik…
          </div>
        )}

        {error && (
          <div style={{ alignSelf: "center", fontSize: 12, color: "#9a4632" }}>{error}</div>
        )}
      </div>

      {/* input */}
      <div
        style={{
          borderTop: "1px solid #efe7d6",
          padding: "12px 16px",
          display: "flex",
          gap: 9,
          alignItems: "flex-end",
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Tulis jawabanmu…"
          disabled={loading}
          style={{
            flex: 1,
            border: "1px solid #e3d9c5",
            borderRadius: 9,
            background: "#fbf7ee",
            padding: "10px 12px",
            fontSize: 13,
            lineHeight: 1.5,
            color: "#2c2620",
            resize: "vertical",
            minHeight: 40,
            fontFamily: "var(--font-sans)",
            outline: "none",
          }}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            border: "none",
            borderRadius: 9,
            padding: "10px 18px",
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background: accent,
            cursor: loading || !input.trim() ? "default" : "pointer",
            opacity: loading || !input.trim() ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          Kirim
        </button>
      </div>
    </div>
  );
}
