"use client";

import { useEffect, useRef, useState } from "react";
import { getModel } from "@/lib/models";
import { TUTORING_POLICY } from "@/lib/tutor/tutorPolicy";
import { STATUS_LABELS } from "@/lib/tutor/tutorPromptTier";
import type { TutorGapView, TutorMessageView, TutorSessionView } from "@/lib/tutor/tutorService";

interface Props {
  resultId: string;
  modelKey: string;
  accent: string;
}

type SessionStatus = TutorSessionView["status"];

type GapWithTopic = TutorGapView & {
  topic_id?: string | null;
  topic_label?: string | null;
  topic_order?: number | null;
};

interface TopicGroup {
  key: string;
  label: string | null;
  order: number;
  index: number;
  items: GapWithTopic[];
}

function groupByTopic(gaps: GapWithTopic[]): TopicGroup[] {
  const map = new Map<string, TopicGroup>();
  gaps.forEach((g, i) => {
    const label = g.topic_label ?? null;
    const key = g.topic_id ?? (label ? `label:${label}` : "__none");
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        label,
        order: g.topic_order ?? Number.POSITIVE_INFINITY,
        index: i,
        items: [],
      };
      map.set(key, group);
    }
    group.items.push(g);
  });
  return [...map.values()].sort((a, b) => (a.order === b.order ? a.index - b.index : a.order - b.order));
}

const TOPIC_LABEL_STYLE = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.3,
  color: "#7a6e59",
  textTransform: "uppercase",
} as const;

const STATUS_CHIP: Record<string, { bg: string; fg: string }> = {
  open: { bg: "#f3ede0", fg: "#7a6e59" },
  in_progress: { bg: "#fbefd9", fg: "#9a6a1f" },
  closed: { bg: "#e7f0e8", fg: "#3f6b4a" },
  exhausted: { bg: "#f6e3dc", fg: "#9a4632" },
  skipped: { bg: "#efeae0", fg: "#8a7f6b" },
  disputed: { bg: "#ece6f3", fg: "#6a5a8a" },
  abandoned: { bg: "#efeae0", fg: "#8a7f6b" },
};

export default function ChatPanel({ resultId, modelKey, accent }: Props) {
  const model = getModel(modelKey);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [gaps, setGaps] = useState<TutorGapView[]>([]);
  const [messages, setMessages] = useState<TutorMessageView[]>([]);
  const [status, setStatus] = useState<SessionStatus>("active");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noRubric, setNoRubric] = useState(false);

  const startedRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (startedRef.current === resultId) return;
    startedRef.current = resultId;
    (async () => {
      try {
        const res = await fetch("/api/tutor/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resultId }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data?.code === "no_rubric") {
            setNoRubric(true);
            return;
          }
          throw new Error(data?.error ?? `HTTP ${res.status}`);
        }
        const view = data as TutorSessionView;
        setSessionId(view.sessionId);
        setGaps(view.gaps);
        setMessages(view.messages);
        setStatus(view.status);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal memuat sesi tutoring");
      } finally {
        setLoading(false);
      }
    })();
  }, [resultId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const completed = status === "completed";
  const disabled = loading || completed || !sessionId;

  const statusGroups = groupByTopic(gaps);
  const openGroups = groupByTopic(gaps.filter((g) => g.status === "open"));

  const canChoose = !disabled && !gaps.some((g) => g.status === "in_progress");

  const send = async (gap?: TutorGapView) => {
    const text = gap ? `Aku mau mulai dari: ${gap.checkpoint_label}` : input.trim();
    if (!text || disabled) return;
    setMessages((m) => [...m, { seq: -Date.now(), role: "user", content: text }]);
    if (!gap) setInput("");
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tutor/session/${sessionId}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, gapId: gap?.gap_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setMessages((m) => [...m, { seq: Date.now(), role: "assistant", content: data.reply as string }]);
      if (Array.isArray(data.gaps) && data.gaps.length) setGaps(data.gaps as TutorGapView[]);
      setStatus(data.status as SessionStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat balasan");
    } finally {
      setLoading(false);
    }
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
          — {model?.label} memandu tutoring per kriteria rubrik
        </span>
      </div>

      {noRubric ? (
        <div style={{ padding: "18px 22px", fontSize: 13, color: "#7a6e59" }}>
          Tutoring membutuhkan rubrik.
        </div>
      ) : (
        <>
          {/* gaps */}
          {gaps.length > 0 && (
            <div
              style={{
                padding: "12px 22px",
                borderBottom: "1px solid #efe7d6",
                display: "flex",
                flexDirection: "column",
                gap: 7,
              }}
            >
              {statusGroups.map((group) => (
                <div key={group.key} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {group.label && <div style={TOPIC_LABEL_STYLE}>{group.label}</div>}
                  {group.items.map((g) => {
                    const chip = STATUS_CHIP[g.status] ?? STATUS_CHIP.open;
                    return (
                      <div
                        key={g.gap_id}
                        style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "#3a342b" }}
                      >
                        <span style={{ flex: 1, minWidth: 0 }}>{g.checkpoint_label}</span>
                        <span style={{ fontSize: 11, color: "#9a8e79", flexShrink: 0 }}>
                          giliran {g.turn_no}/{TUTORING_POLICY.max_turns} · percobaan {g.attempts}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            borderRadius: 999,
                            padding: "2px 9px",
                            background: chip.bg,
                            color: chip.fg,
                            flexShrink: 0,
                          }}
                        >
                          {STATUS_LABELS[g.status] ?? g.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

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
            {messages.map((m) => {
              const mine = m.role === "user";
              return (
                <div
                  key={m.seq}
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

            {canChoose && !loading && openGroups.length > 0 && (
              <div style={{ alignSelf: "flex-start", display: "flex", flexDirection: "column", gap: 10, maxWidth: "78%" }}>
                {openGroups.map((group) => (
                  <div key={group.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {group.label && <div style={TOPIC_LABEL_STYLE}>{group.label}</div>}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                      {group.items.map((g) => (
                        <button
                          key={g.gap_id}
                          onClick={() => send(g)}
                          style={{
                            border: `1px solid ${accent}`,
                            borderRadius: 999,
                            padding: "6px 13px",
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: accent,
                            background: "#fffdf7",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          {g.checkpoint_label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

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
                {sessionId ? "mengetik…" : "memuat sesi…"}
              </div>
            )}

            {completed && (
              <div style={{ alignSelf: "center", fontSize: 12, color: "#3f6b4a" }}>
                Sesi tutoring selesai.
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
              placeholder={completed ? "Sesi sudah selesai" : "Tulis jawabanmu…"}
              disabled={disabled}
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
              onClick={() => send()}
              disabled={disabled || !input.trim()}
              style={{
                border: "none",
                borderRadius: 9,
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 600,
                color: "#fff",
                background: accent,
                cursor: disabled || !input.trim() ? "default" : "pointer",
                opacity: disabled || !input.trim() ? 0.5 : 1,
                flexShrink: 0,
              }}
            >
              Kirim
            </button>
          </div>
        </>
      )}
    </div>
  );
}
