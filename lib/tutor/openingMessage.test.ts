import assert from "node:assert/strict";
import { it as test } from "vitest";
import { buildOpeningMessage, computeScaledScore } from "./openingMessage";

const base = {
  assessmentTitle: "UTS PBO",
  courseName: "Pemrograman Berorientasi Objek",
  scaledScore: 56.67,
  unmasteredCount: 3,
};

test("opening message: full template with every value present", () => {
  assert.equal(
    buildOpeningMessage(base),
    "Hasil UTS PBO dari mata kuliah Pemrograman Berorientasi Objek kamu udah aku terima, " +
      "nilainya 56.67/100. Ada 3 konsep yang sepertinya belum kamu kuasai. Mau mulai dari mana dulu?",
  );
});

test("opening message: a whole score loses its trailing zeros", () => {
  const msg = buildOpeningMessage({ ...base, scaledScore: 50 });
  assert.match(msg, /nilainya 50\/100\./);
  assert.doesNotMatch(msg, /50\.00/);
});

test("opening message: one decimal stays one decimal; an unrounded value is re-rounded", () => {
  assert.match(buildOpeningMessage({ ...base, scaledScore: 56.7 }), /nilainya 56\.7\/100/);
  assert.match(
    buildOpeningMessage({ ...base, scaledScore: 66.66666666 }),
    /nilainya 66\.67\/100/,
  );
});

test("opening message: no subject on the class drops the 'mata kuliah' clause, not the sentence", () => {
  const msg = buildOpeningMessage({ ...base, courseName: null });
  assert.equal(
    msg,
    "Hasil UTS PBO kamu udah aku terima, nilainya 56.67/100. " +
      "Ada 3 konsep yang sepertinya belum kamu kuasai. Mau mulai dari mana dulu?",
  );
  assert.doesNotMatch(msg, /mata kuliah/, "never renders an empty course slot");
});

test("opening message: a blank course name is treated as absent", () => {
  assert.doesNotMatch(buildOpeningMessage({ ...base, courseName: "   " }), /mata kuliah/);
});

test("opening message: an unscorable submission drops the score clause", () => {
  const msg = buildOpeningMessage({ ...base, scaledScore: null });
  assert.equal(
    msg,
    "Hasil UTS PBO dari mata kuliah Pemrograman Berorientasi Objek kamu udah aku terima. " +
      "Ada 3 konsep yang sepertinya belum kamu kuasai. Mau mulai dari mana dulu?",
  );
  assert.doesNotMatch(msg, /null/, "no null ever reaches the student");
  assert.doesNotMatch(msg, /nilainya/);
});

test("opening message: never renders a hole for a missing title", () => {
  const msg = buildOpeningMessage({ ...base, assessmentTitle: "  " });
  assert.match(msg, /^Hasil asesmen dari mata kuliah /);
  assert.doesNotMatch(msg, /Hasil {2}/);
});

test("opening message: a zero count drops the concepts sentence, keeps the invitation", () => {
  const msg = buildOpeningMessage({ ...base, unmasteredCount: 0 });
  assert.doesNotMatch(msg, /konsep/);
  assert.match(msg, /Mau mulai dari mana dulu\?$/);
});

test("opening message: the count is rendered verbatim, singular included", () => {
  assert.match(buildOpeningMessage({ ...base, unmasteredCount: 1 }), /Ada 1 konsep /);
  assert.match(buildOpeningMessage({ ...base, unmasteredCount: 12 }), /Ada 12 konsep /);
});

test("opening message: everything absent still yields a sound sentence", () => {
  assert.equal(
    buildOpeningMessage({
      assessmentTitle: "",
      courseName: null,
      scaledScore: null,
      unmasteredCount: 0,
    }),
    "Hasil asesmen kamu udah aku terima. Mau mulai dari mana dulu?",
  );
});

test("scaled score: rubric total rescaled to 0-100, rounded to 2 decimals", () => {
  assert.equal(computeScaledScore(5, 9), 55.56);
  assert.equal(computeScaledScore(9, 9), 100);
  assert.equal(computeScaledScore(0, 9), 0);
  assert.equal(computeScaledScore(5, 0), null);
  assert.equal(computeScaledScore(null, 9), null);
});
