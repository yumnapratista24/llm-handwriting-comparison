import OpenAI from "openai";
import { getModel, type GradeResponse, type Citation } from "@/lib/models";
import {
  composeSystemPrompt,
  buildUserPrompt,
  buildMaterialBlock,
  buildGradeTool,
  type RubricCriterion,
  type PromptChunk,
} from "@/lib/prompt";
import { retrieveForGrading, type RetrievedChunk } from "@/lib/rag";

export const runtime = "nodejs";

interface GradeRequest {
  modelKey: string;
  question: string;
  images: string[];
  systemPrompt?: string;
  rubric?: RubricCriterion[];
  answerText?: string;
  documentIds?: string[];
}

function err(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

const toPromptChunk = (c: RetrievedChunk): PromptChunk => ({
  chunkId: c.chunkId,
  document: c.document,
  content: c.content,
});

export async function POST(request: Request) {
  const apiKey = process.env.SUMOPOD_API_KEY;
  if (!apiKey) return err("SUMOPOD_API_KEY belum diset di .env.local", 500);

  let body: GradeRequest;
  try {
    body = (await request.json()) as GradeRequest;
  } catch {
    return err("Body permintaan tidak valid", 400);
  }

  const { modelKey, question, images, systemPrompt, rubric, answerText } = body;
  const documentIds = body.documentIds ?? [];
  const answer = answerText?.trim();

  const model = getModel(modelKey);
  if (!model) return err(`Model tidak dikenal: ${modelKey}`, 400);
  if (!question?.trim()) return err("Soal esai kosong", 400);
  if (!answer && !images?.length) {
    return err("Tidak ada jawaban — unggah gambar atau ketik jawaban", 400);
  }

  // Retrieve source material (if any) — RAG only, keyed on question (+ answer text).
  let material: RetrievedChunk[] = [];
  if (documentIds.length > 0) {
    try {
      material = await retrieveForGrading(documentIds, question, answer);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Pengambilan materi gagal";
      console.error("[grade] material:", message);
      return err(`Gagal mengambil materi sumber: ${message}`, 502);
    }
  }
  const promptChunks = material.map(toPromptChunk);

  const client = new OpenAI({ apiKey, baseURL: "https://ai.sumopod.com/v1" });

  // Text answer → grade the text directly (no images). Otherwise send images.
  const imageContent = answer
    ? []
    : images.map((url) => ({ type: "image_url" as const, image_url: { url } }));

  const systemMessage = composeSystemPrompt(systemPrompt);
  const userText = buildUserPrompt(question, rubric, answer);

  // Material rides as its own text part, ahead of the question.
  const materialContent = promptChunks.length
    ? [{ type: "text" as const, text: buildMaterialBlock(promptChunks) }]
    : [];

  console.log(
    "[grade] chunks:",
    material.length,
    "answer:",
    answer ? "text" : "images",
  );

  const start = performance.now();
  let res;
  try {
    res = await client.chat.completions.create({
      model: model.sumopodId,
      messages: [
        { role: "system", content: systemMessage },
        {
          role: "user",
          content: [...materialContent, { type: "text", text: userText }, ...imageContent],
        },
      ],
      tools: [buildGradeTool(!!rubric?.length, promptChunks.length > 0)],
      tool_choice: { type: "function", function: { name: "grade_answer" } },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Panggilan ke SumoPod gagal";
    console.error("[grade] SumoPod error:", message);
    const status = /\b4\d\d\b/.exec(message)?.[0];
    return err(message, status ? Number(status) : 502);
  }
  const latency = +((performance.now() - start) / 1000).toFixed(1);

  console.log("[grade] model:", model.sumopodId, "usage:", JSON.stringify(res.usage));

  const toolCall = res.choices?.[0]?.message?.tool_calls?.[0];
  const args = toolCall?.type === "function" ? toolCall.function.arguments : undefined;
  if (!args) return err("Model tidak mengembalikan hasil penilaian (grade_answer)", 502);

  let parsed: Partial<GradeResponse>;
  try {
    parsed = JSON.parse(args);
  } catch {
    return err("Hasil grade_answer bukan JSON valid", 502);
  }

  // Text answers: the provided text IS the answer — no transcription.
  const extracted_text = answer ? answer : parsed.extracted_text ?? "";
  const extraction_note = answer
    ? "Jawaban diberikan dalam bentuk teks."
    : parsed.extraction_note ?? "";

  const citations =
    Array.isArray(parsed.citations) && parsed.citations.length
      ? parsed.citations
          .map((c: Citation) => ({
            chunk_id: String(c.chunk_id ?? ""),
            document: String(c.document ?? ""),
            snippet: String(c.snippet ?? ""),
          }))
          .filter((c) => c.chunk_id)
      : undefined;

  const payload: GradeResponse = {
    extracted_text,
    extraction_note,
    score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, Math.round(parsed.score))) : 0,
    feedback_text:   parsed.feedback_text   ?? "",
    strengths:       Array.isArray(parsed.strengths)    ? parsed.strengths    : [],
    improvements:    Array.isArray(parsed.improvements) ? parsed.improvements : [],
    rubric_breakdown:
      Array.isArray(parsed.rubric_breakdown) && parsed.rubric_breakdown.length
        ? parsed.rubric_breakdown.map((r: Record<string, unknown>) => ({
            criterion: String(r.criterion ?? ""),
            max: Number(r.max ?? 0),
            awarded: Number(r.awarded ?? 0),
            reason: String(r.reason ?? ""),
          }))
        : undefined,
    citations: citations && citations.length ? citations : undefined,
    usage: {
      prompt_tokens:     res.usage?.prompt_tokens     ?? null,
      completion_tokens: res.usage?.completion_tokens ?? null,
      total_tokens:      res.usage?.total_tokens      ?? null,
    },
    latency,
  };

  return Response.json(payload);
}
