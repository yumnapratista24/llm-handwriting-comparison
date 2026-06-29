import { DEFAULT_PROMPT } from "@/lib/prompt";

interface Props {
  open: boolean;
  value: string;
  onChange: (v: string) => void;
  onReset: () => void;
  onClose: () => void;
  accent: string;
}

export default function PromptDrawer({ open, value, onChange, onReset, onClose, accent }: Props) {
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
        {/* drawer header */}
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
            System Prompt
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

        {/* content */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "18px 20px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <p
            style={{
              margin: "0 0 13px",
              fontSize: 12.5,
              lineHeight: 1.55,
              color: "#7a6f5e",
            }}
          >
            Satu prompt global dipakai untuk{" "}
            <strong style={{ color: "#5a5142" }}>semua model</strong> agar perbandingan adil.
            Soal dikirim otomatis di pesan pengguna — tidak perlu token khusus di sini.
          </p>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{
              flex: 1,
              minHeight: 340,
              width: "100%",
              border: "1px solid #e3d9c5",
              borderRadius: 9,
              background: "#fbf7ee",
              padding: "14px 15px",
              fontSize: 12.5,
              lineHeight: 1.6,
              color: "#2c2620",
              resize: "none",
              fontFamily: "var(--font-mono)",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              marginTop: 13,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "#a2967f",
              }}
            >
              {value.length} karakter
            </span>
            <div style={{ display: "flex", gap: 9 }}>
              <button
                onClick={onReset}
                style={{
                  border: "1px solid #e3d9c5",
                  background: "#fffdf7",
                  borderRadius: 8,
                  padding: "9px 14px",
                  fontSize: 12.5,
                  color: "#5a5142",
                  cursor: "pointer",
                }}
              >
                Reset default
              </button>
              <button
                onClick={onClose}
                style={{
                  border: "none",
                  background: accent,
                  color: "#fff",
                  borderRadius: 8,
                  padding: "9px 16px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Simpan
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

// Export DEFAULT_PROMPT so page.tsx can initialise state without a separate import
export { DEFAULT_PROMPT };
