import { describe, expect, it } from "vitest";
import {
  VERBATIM_NGRAM_SIZE,
  checkVerbatimOverlap,
  longestSharedWordRun,
  normalizeWords,
} from "./tutorVerbatim";

describe("normalizeWords", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeWords("Sebab, dan  AKIBAT!")).toEqual(["sebab", "dan", "akibat"]);
  });
  it("keeps accented / Indonesian letters and digits", () => {
    expect(normalizeWords("café 123 memé")).toEqual(["café", "123", "memé"]);
  });
  it("empty in → empty out", () => {
    expect(normalizeWords("")).toEqual([]);
  });
});

describe("longestSharedWordRun", () => {
  it("finds the longest CONTIGUOUS shared word run", () => {
    const a = "satu dua tiga empat lima".split(" ");
    const b = "nol dua tiga empat enam".split(" ");
    expect(longestSharedWordRun(a, b)).toBe(3);
  });
  it("returns 0 when either side is empty", () => {
    expect(longestSharedWordRun([], ["a"])).toBe(0);
    expect(longestSharedWordRun(["a"], [])).toBe(0);
  });
});

describe("checkVerbatimOverlap (anti-gaming guardrail §6)", () => {
  const explanation =
    "analisis lengkap membutuhkan sebab dan akibat serta bukti konkret yang mendukung argumen utama";

  it("flags a long verbatim copy of the tutor's turn-3 explanation", () => {
    const r = checkVerbatimOverlap(explanation, explanation);
    expect(r.contaminated).toBe(true);
    expect(r.longestRun).toBeGreaterThanOrEqual(VERBATIM_NGRAM_SIZE);
    expect(r.n).toBe(VERBATIM_NGRAM_SIZE);
  });

  it("does NOT flag an answer written in the student's own words", () => {
    const own = "menurutku kebijakan itu gagal karena target tidak tercapai walau dana habis";
    expect(checkVerbatimOverlap(own, explanation).contaminated).toBe(false);
  });

  it("no reference yet (turns 1–2) → never contaminated (nothing to copy)", () => {
    expect(checkVerbatimOverlap("apa pun jawabannya", null).contaminated).toBe(false);
    expect(checkVerbatimOverlap("apa pun", "").contaminated).toBe(false);
    expect(checkVerbatimOverlap("", explanation).contaminated).toBe(false);
  });

  it("short incidental phrase reuse does not trip it", () => {
    expect(checkVerbatimOverlap("karena itu hasilnya berbeda sekali", explanation).contaminated).toBe(false);
  });

  it("respects a custom n threshold", () => {
    const a = "satu dua tiga empat";
    expect(checkVerbatimOverlap(a, a, 4).contaminated).toBe(true);
    expect(checkVerbatimOverlap(a, a, 5).contaminated).toBe(false);
  });
});
