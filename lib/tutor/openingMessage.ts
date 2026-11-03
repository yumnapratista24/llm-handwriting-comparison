export const SCALED_SCORE_MAX = 100;
const SCALE_DECIMALS = 2;

export function computeScaledScore(
  totalScore: number | null | undefined,
  maxScore: number | null | undefined,
): number | null {
  if (typeof totalScore !== "number" || !Number.isFinite(totalScore))
    return null;
  if (typeof maxScore !== "number" || !Number.isFinite(maxScore)) return null;
  if (maxScore <= 0) return null;

  const factor = 10 ** SCALE_DECIMALS;
  const scaled = (totalScore / maxScore) * SCALED_SCORE_MAX;
  const rounded =
    (Math.sign(scaled) * Math.round(Math.abs(scaled) * factor)) / factor;
  return rounded === 0 ? 0 : rounded;
}

export interface OpeningMessageInput {
  assessmentTitle: string;
  courseName: string | null;
  scaledScore: number | null;
  unmasteredCount: number;
}

function formatScore(score: number): string {
  return String(Number(score.toFixed(2)));
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildOpeningMessage(input: OpeningMessageInput): string {
  const title = clean(input.assessmentTitle);
  const course = clean(input.courseName);
  const hasScore =
    typeof input.scaledScore === "number" && Number.isFinite(input.scaledScore);

  const subject = title ? `Hasil ${title}` : "Hasil asesmen";
  const withCourse = course ? `${subject} dari mata kuliah ${course}` : subject;
  const score = hasScore
    ? `, nilainya ${formatScore(input.scaledScore as number)}/${SCALED_SCORE_MAX}`
    : "";

  const sentences = [`${withCourse} kamu udah aku terima${score}.`];
  if (input.unmasteredCount > 0) {
    sentences.push(
      `Ada ${input.unmasteredCount} konsep yang sepertinya belum kamu kuasai.`,
    );
  }
  sentences.push("Mau mulai dari mana dulu?");

  return sentences.join(" ");
}
