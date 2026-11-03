"use client";

// Modal wrapper around BatchDashboard: the batch results table opens as a
// dialog over the compose view instead of replacing it, so the run's answers
// and rubric stay visible/editable behind it. Closing only hides the dialog —
// the page state is untouched and it can be reopened via "Lihat Hasil".
import BatchDashboard from "@/components/BatchDashboard";
import type { RubricDef } from "@/lib/models";

interface Props {
  open: boolean;
  runId: string | null;
  rubric?: RubricDef[];
  documentIds?: string[];
  accent: string;
  onClose: () => void;
}

export default function BatchResultsDialog({
  open,
  runId,
  rubric,
  documentIds,
  accent,
  onClose,
}: Props) {
  if (!open || !runId) return null;
  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Hasil penilaian batch"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(44,38,32,.45)",
        zIndex: 60, // above the drawers (40/50)
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "4vh 20px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#f4eee1",
          border: "1px solid #e2d8c4",
          borderRadius: 14,
          boxShadow: "0 18px 60px rgba(50,38,20,.28)",
          width: "min(1200px, 100%)",
          maxHeight: "92vh",
          overflowY: "auto",
          padding: "20px 22px",
        }}
      >
        {/* keyed so switching runs remounts with fresh polling state */}
        <BatchDashboard
          key={runId}
          runId={runId}
          rubric={rubric}
          documentIds={documentIds}
          accent={accent}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
