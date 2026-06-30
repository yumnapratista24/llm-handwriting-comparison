import { useState } from "react";
import { type Run } from "@/lib/models";
import { getModel } from "@/lib/models";

interface Props {
  open: boolean;
  runs: Run[];
  currentRunId: string | null;
  onOpen: (runId: string) => void;
  onRemove: (runId: string) => void;
  onRename: (runId: string, title: string) => void;
  onClose: () => void;
  accent: string;
}

function timeStr(ts: number) {
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function HistoryDrawer({
  open,
  runs,
  currentRunId,
  onOpen,
  onRemove,
  onRename,
  onClose,
  accent,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  function startEdit(e: React.MouseEvent, run: Run) {
    e.stopPropagation();
    setEditingId(run.id);
    setEditValue(run.title ?? "");
  }

  function confirmEdit(runId: string) {
    onRename(runId, editValue);
    setEditingId(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  const backdropStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(44,34,20,.34)",
    zIndex: 40,
    opacity: open ? 1 : 0,
    pointerEvents: open ? "auto" : "none",
    transition: "opacity .28s ease",
  };

  const drawerStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    right: 0,
    height: "100vh",
    width: 460,
    maxWidth: "92vw",
    background: "#fffdf7",
    borderLeft: "1px solid #e6dcc7",
    boxShadow: "-12px 0 40px rgba(60,40,20,.12)",
    display: "flex",
    flexDirection: "column",
    zIndex: 50,
    transform: open ? "translateX(0)" : "translateX(102%)",
    transition: "transform .28s cubic-bezier(.4,0,.2,1)",
  };

  return (
    <>
      <div onClick={onClose} style={backdropStyle} />
      <aside style={drawerStyle}>
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "18px 20px",
            borderBottom: "1px solid #efe7d6",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 18,
              fontWeight: 600,
              color: "#2c2620",
            }}
          >
            Riwayat Run
          </div>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "#f3ecdb",
              width: 28,
              height: 28,
              borderRadius: 7,
              color: "#6b6151",
              fontSize: 16,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* list */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 18px" }}>
          {runs.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "48px 20px",
                color: "#9a8e79",
              }}
            >
              <div style={{ fontSize: 26, marginBottom: 10, opacity: 0.5 }}>◗</div>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                Belum ada run tersimpan.
                <br />
                Hasil Generate akan muncul di sini.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {runs.map((run) => {
                const isCurrent = run.id === currentRunId;
                const doneCount = run.results.filter((r) => r.status === "done").length;
                const modelKeys = [...new Set(run.results.map((r) => r.modelKey))];
                const isEditing = editingId === run.id;

                return (
                  <div
                    key={run.id}
                    onClick={() => onOpen(run.id)}
                    style={{
                      cursor: "pointer",
                      borderRadius: 10,
                      padding: "13px 14px",
                      background: isCurrent ? "#fbf7ee" : "#fffdf7",
                      border: isCurrent
                        ? `1.5px solid ${accent}`
                        : "1px solid #e6dcc7",
                    }}
                  >
                    {/* top row: timestamp + actions */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        marginBottom: 8,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 11.5,
                          color: "#6b6151",
                          fontWeight: 500,
                        }}
                      >
                        {timeStr(run.ts)}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        {isCurrent && (
                          <span
                            title="Klik untuk batalkan pilihan"
                            style={{
                              fontSize: 9.5,
                              background: accent,
                              color: "#fff",
                              borderRadius: 20,
                              padding: "1px 7px",
                              cursor: "pointer",
                            }}
                          >
                            aktif ×
                          </span>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); onRemove(run.id); }}
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "#b3a690",
                            fontSize: 14,
                            lineHeight: 1,
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </div>

                    {/* title row */}
                    <div
                      style={{ marginBottom: 8 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isEditing ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input
                            autoFocus
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") confirmEdit(run.id);
                              if (e.key === "Escape") cancelEdit();
                            }}
                            placeholder="Nama sesi ini…"
                            style={{
                              flex: 1,
                              fontSize: 12,
                              border: "1px solid #e3d9c5",
                              borderRadius: 7,
                              background: "#fbf7ee",
                              padding: "3px 8px",
                              color: "#2c2620",
                              outline: "none",
                              fontFamily: "var(--font-sans)",
                            }}
                          />
                          <button
                            onClick={() => confirmEdit(run.id)}
                            title="Simpan"
                            style={{
                              border: "none",
                              background: "transparent",
                              color: accent,
                              fontSize: 15,
                              cursor: "pointer",
                              lineHeight: 1,
                              padding: "2px 0",
                              flexShrink: 0,
                            }}
                          >
                            ✓
                          </button>
                        </div>
                      ) : (
                        <span
                          onClick={(e) => startEdit(e, run)}
                          title="Klik untuk memberi nama"
                          style={{
                            display: "inline-block",
                            fontSize: 12,
                            color: run.title ? "#3a342b" : "#c4b89f",
                            background: "#f3ecdb",
                            borderRadius: 20,
                            padding: "2px 10px",
                            cursor: "text",
                            fontStyle: run.title ? "normal" : "italic",
                          }}
                        >
                          {run.title ?? "Tambah judul…"}
                        </span>
                      )}
                    </div>

                    {/* question snippet */}
                    <div
                      style={{
                        fontSize: 12,
                        color: "#4a4337",
                        lineHeight: 1.45,
                        marginBottom: 10,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      } as React.CSSProperties}
                    >
                      {run.question}
                    </div>

                    {/* model chips */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {modelKeys.map((key) => {
                        const m = getModel(key);
                        if (!m) return null;
                        return (
                          <span
                            key={key}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              background: "#f3ecdb",
                              borderRadius: 20,
                              padding: "3px 8px",
                              fontSize: 10.5,
                              color: "#5a5142",
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: m.dot,
                              }}
                            />
                            {m.label}
                          </span>
                        );
                      })}
                    </div>

                    {/* summary */}
                    <div style={{ marginTop: 9, fontSize: 10.5, color: "#a2967f" }}>
                      {doneCount} / {run.results.length} hasil selesai
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
