import { TUTORING_POLICY_V1 } from "./tutorPolicy";
import {
  activeGap,
  isTerminalStatus,
  nonTerminalGaps,
  type RuntimeGap,
  type TutorRuntimeState,
} from "./tutorStateMachine";

export const STATUS_LABELS: Record<string, string> = {
  open: "belum dikerjakan",
  in_progress: "sedang dikerjakan",
  closed: "selesai",
  exhausted: "butuh dosen",
  skipped: "dilewati",
  disputed: "diajukan ke dosen",
  abandoned: "terbengkalai",
};

export type TutorPhaseKind =
  | "offer_gaps"
  | "probe"
  | "ask_next"
  | "explain_transfer"
  | "contaminated"
  | "closed"
  | "exhausted"
  | "complete";

export function phaseInstructionText(kind: TutorPhaseKind): string {
  switch (kind) {
    case "offer_gaps":
      return "Fase: belum ada checkpoint aktif. Tawarkan topik yang tersisa (beserta checkpoint di dalamnya) dan ajak murid mulai dari topik teratas lewat balasan biasa.";
    case "probe":
      return "Fase: mulai gap aktif dengan pertanyaan probe giliran 1 (terbuka, tanpa petunjuk isi).";
    case "ask_next":
      return "Fase: jawaban sebelumnya belum lengkap. Sampaikan arah kekurangannya (lihat 'kurang'), lalu ajukan SATU pertanyaan scaffold giliran ini.";
    case "explain_transfer":
      return "Fase: giliran 3. Jelaskan elemen yang kurang secara ringkas, LALU tutup dengan SATU pertanyaan transfer pada kasus/konteks BARU.";
    case "contaminated":
      return "Fase: jawaban murid menyalin penjelasanmu kata demi kata. Katakan dengan hangat bahwa itu kata-katamu dan minta ia menjawab dengan kata-katanya sendiri pada kasus yang kamu tanyakan.";
    case "closed":
      return "Fase: gap ini LOLOS. Sampaikan dengan hangat lalu tawarkan gap berikutnya.";
    case "exhausted":
      return "Fase: gap ini ditutup tanpa lolos. Tutup dengan hangat, sebut bahwa ini akan terlihat oleh dosen, lalu tawarkan gap berikutnya.";
    case "complete":
      return "Fase: semua gap sudah selesai. Tutup sesi dengan rangkuman singkat yang menyemangati.";
  }
}

export function buildClassContextTier(input: {
  classLabel?: string | null;
  assessmentTitle?: string | null;
}): string {
  const lines = ["# Konteks kelas"];
  if (input.classLabel) lines.push(`Kelas: ${input.classLabel}`);
  if (input.assessmentTitle) lines.push(`Asesmen: ${input.assessmentTitle}`);
  if (lines.length === 1) lines.push("Sesi tutoring rubrik.");
  return lines.join("\n");
}

export function buildTutorStaticTiers(input: {
  classLabel?: string | null;
  assessmentTitle?: string | null;
}): string[] {
  return [TUTORING_POLICY_V1, buildClassContextTier(input)];
}

function readString(gap: RuntimeGap, key: string): string | null {
  const v = (gap as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function checkpointName(gap: RuntimeGap): string {
  return readString(gap, "checkpoint_label") ?? readString(gap, "criterion_name") ?? gap.gap_id;
}

function topicLabelOf(gap: RuntimeGap): string | null {
  return readString(gap, "topic_label");
}

function renderSourceQuestions(gap: RuntimeGap): string | null {
  const raw = (gap as Record<string, unknown>).source_questions;
  if (!Array.isArray(raw)) return null;
  const prompts: string[] = [];
  for (const e of raw) {
    if (e && typeof e === "object") {
      const p = (e as Record<string, unknown>).question_prompt;
      if (typeof p === "string" && p.trim()) prompts.push(p);
    }
  }
  if (prompts.length === 0) return null;
  return prompts.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
}

function renderWeakSourceRefs(gap: RuntimeGap): string | null {
  const raw = (gap as Record<string, unknown>).weak_source_refs;
  if (!Array.isArray(raw)) return null;
  const lines: string[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const prompt = typeof o.question_prompt === "string" && o.question_prompt.trim()
      ? o.question_prompt
      : null;
    if (!prompt) continue;
    const fb = typeof o.criterion_feedback === "string" && o.criterion_feedback.trim()
      ? ` — catatan: ${o.criterion_feedback}`
      : "";
    lines.push(`  - kamu masih belum tepat di: ${prompt}${fb}`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function renderActiveGap(gap: RuntimeGap): string {
  const topic = topicLabelOf(gap);
  const lines: string[] = [`## Checkpoint aktif: ${checkpointName(gap)}`];
  if (topic) lines.push(`- Topik: ${topic}`);
  const descriptor = readString(gap, "descriptor");
  if (descriptor) lines.push(`- Deskriptor (yang harus dikuasai):\n${descriptor}`);
  const sourceQuestions = renderSourceQuestions(gap);
  if (sourceQuestions) lines.push(`- Soal terkait:\n${sourceQuestions}`);
  const weak = renderWeakSourceRefs(gap);
  if (weak) lines.push(`- Sorotan (soal terlemah murid):\n${weak}`);
  lines.push(`- Giliran saat ini: ${gap.turn_no} (dari 3)`);
  lines.push(`- Jumlah percobaan: ${gap.attempts}`);
  if (gap.last_verdict) {
    lines.push(`- Hasil penilaian terakhir: ${gap.last_verdict === "pass" ? "lolos" : "belum lolos"}`);
  }
  if (gap.last_missing && gap.last_missing.length > 0) {
    lines.push(`- Yang masih kurang: ${gap.last_missing.join("; ")}`);
  }
  const studentAnswer = readString(gap, "student_answer");
  if (studentAnswer) lines.push(`- Jawaban awal murid pada tugas:\n${studentAnswer}`);
  const feedback = readString(gap, "criterion_feedback");
  if (feedback) lines.push(`- Catatan penilaian:\n${feedback}`);
  return lines.join("\n");
}

function renderGapList(state: TutorRuntimeState): string {
  const lines = ["## Semua topik"];
  const order: Array<string | null> = [];
  const seen = new Set<string | null>();
  for (const g of state.gaps) {
    const t = topicLabelOf(g);
    if (!seen.has(t)) {
      seen.add(t);
      order.push(t);
    }
  }
  for (const t of order) {
    lines.push(t ? `- Topik: ${t}` : `- Checkpoint`);
    for (const g of state.gaps) {
      if (topicLabelOf(g) !== t) continue;
      const label = STATUS_LABELS[g.status] ?? g.status;
      lines.push(`  - ${checkpointName(g)}: ${label}`);
    }
  }
  return lines.join("\n");
}

export function buildGapStateBlock(input: {
  state: TutorRuntimeState;
  phase: TutorPhaseKind;
  activeGapId?: string | null;
}): string {
  const { state, phase } = input;
  const active =
    (input.activeGapId ? state.gaps.find((g) => g.gap_id === input.activeGapId) : undefined) ??
    activeGap(state);

  const sections = ["# STATUS GAP"];
  if (active && !isTerminalStatus(active.status)) {
    sections.push(renderActiveGap(active));
  } else {
    const remaining = nonTerminalGaps(state).length;
    sections.push(
      remaining > 0
        ? "Tidak ada gap aktif saat ini."
        : "Tidak ada gap aktif; semua gap sudah selesai.",
    );
  }
  sections.push(renderGapList(state));
  sections.push(phaseInstructionText(phase));
  return sections.join("\n\n");
}
