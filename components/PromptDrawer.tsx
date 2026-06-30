import { DEFAULT_PROMPT } from "@/lib/prompt";

interface Props {
  open: boolean;
  value: string;
  onChange: (v: string) => void;
  onReset: () => void;
  onClose: () => void;
  accent: string;
}

export default function PromptDrawer({
  open,
  value,
  onChange,
  onReset,
  onClose,
  accent,
}: Props) {
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
            <strong style={{ color: "#5a5142" }}>semua model</strong> agar
            perbandingan adil. Soal dikirim otomatis di pesan pengguna — tidak
            perlu token khusus di sini.
          </p>

          {/* accordion: default prompt preview */}
          <details
            style={{
              marginBottom: 14,
              border: "1px solid #e3d9c5",
              borderRadius: 9,
              background: "#fbf7ee",
              overflow: "hidden",
            }}
          >
            <summary
              style={{
                padding: "9px 13px",
                fontSize: 12,
                color: "#7a6f5e",
                cursor: "pointer",
                userSelect: "none",
                fontFamily: "var(--font-mono)",
                listStyle: "none",
                display: "flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              <span style={{ fontSize: 10 }}>▶</span> Lihat contoh default
              prompt
            </summary>
            <div style={{ padding: "0 13px 13px" }}>
              <pre
                style={{
                  margin: "10px 0 8px",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11.5,
                  lineHeight: 1.6,
                  color: "#3a342b",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background: "#f3ecdb",
                  border: "1px solid #e3d9c5",
                  borderRadius: 7,
                  padding: "11px 13px",
                  maxHeight: 200,
                  overflow: "auto",
                }}
              >
                {DEFAULT_PROMPT}
              </pre>
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: "#a2967f",
                  lineHeight: 1.5,
                }}
              >
                Catatan:{" "}
                <strong style={{ color: "#7a6f5e" }}>IMPORTANT NOTES</strong>{" "}
                selalu ditambahkan otomatis di akhir oleh sistem — tidak perlu
                ditulis di sini.
              </p>
            </div>
          </details>

          {/* guidance hint */}
          <div
            style={{
              marginBottom: 10,
              padding: "10px 13px",
              background: "#f6ecd5",
              border: "1px solid #e3d9c5",
              borderRadius: 8,
              fontSize: 12,
              color: "#7a6f5e",
              lineHeight: 1.6,
            }}
          >
            <strong
              style={{ color: "#5a5142", display: "block", marginBottom: 4 }}
            >
              Tips penulisan prompt
            </strong>
            Definisikan dengan lengkap behavior apa yang ingin LLM lakukan.
            Seperti:
            <ol style={{ margin: "5px 0 0", paddingLeft: 18 }}>
              <li>Language</li>
              <li>Feedback style</li>
              <li>Evaluation method (e.g. Glow & Grow, etc </li>
              <li>etc</li>
            </ol>
          </div>

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
