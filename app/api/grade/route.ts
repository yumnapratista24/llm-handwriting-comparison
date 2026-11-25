import type OpenAI from "openai";
import { getModel, type GradeResponse } from "@/lib/models";
import {
  OPENROUTER_KEY_MISSING_MESSAGE,
  openRouterClient,
  openRouterKey,
} from "@/lib/openrouter";
import { type RubricCriterion, type PromptChunk } from "@/lib/prompt";
import {
  buildGradeRequestPayload,
  parseGradeToolResponse,
  type GradeAnswerContent,
  type ParsedGrade,
} from "@/lib/grading";
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
  const apiKey = openRouterKey();
  if (!apiKey) return err(OPENROUTER_KEY_MISSING_MESSAGE, 500);

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

  // Forced through OpenRouter — see lib/openrouter.ts.
  const client = openRouterClient(apiKey);

  // Text answer → grade the text directly (no images). Otherwise send images.
  const answerContent: GradeAnswerContent = answer
    ? { mode: "text", text: answer }
    : { mode: "images", imageUrls: images };

  const payload = buildGradeRequestPayload({
    openrouterId: model.openrouterId,
    systemPrompt,
    question,
    rubric,
    material: promptChunks,
    answer: answerContent,
  });

  console.log(
    "[grade] chunks:",
    material.length,
    "answer:",
    answer ? "text" : "images",
  );

  const start = performance.now();
  let res;
  try {
    res = await client.chat.completions.create(
      payload as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Panggilan ke OpenRouter gagal";
    console.error("[grade] OpenRouter error:", message);
    const status = /\b4\d\d\b/.exec(message)?.[0];
    return err(message, status ? Number(status) : 502);
  }
  const latency = +((performance.now() - start) / 1000).toFixed(1);

  console.log("[grade] model:", model.openrouterId, "usage:", JSON.stringify(res.usage));

  const toolCall = res.choices?.[0]?.message?.tool_calls?.[0];
  const args = toolCall?.type === "function" ? toolCall.function.arguments : undefined;
  if (!args) return err("Model tidak mengembalikan hasil penilaian (grade_answer)", 502);

  let grade: ParsedGrade;
  try {
    grade = parseGradeToolResponse(args, { answerText: answer });
  } catch {
    return err("Hasil grade_answer bukan JSON valid", 502);
  }

  const payloadOut: GradeResponse = {
    ...grade,
    usage: {
      prompt_tokens:     res.usage?.prompt_tokens     ?? null,
      completion_tokens: res.usage?.completion_tokens ?? null,
      total_tokens:      res.usage?.total_tokens      ?? null,
    },
    latency,
  };

  return Response.json(payloadOut);
}
