import OpenAI from "openai";
import { getModel, type GradeResponse } from "@/lib/models";
import { DEFAULT_PROMPT, buildUserPrompt, GRADE_TOOL } from "@/lib/prompt";

export const runtime = "nodejs";

interface GradeRequest {
  modelKey: string;
  question: string;
  images: string[];
  systemPrompt?: string;
}

function err(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const apiKey = process.env.SUMOPOD_API_KEY;
  if (!apiKey) return err("SUMOPOD_API_KEY belum diset di .env.local", 500);

  let body: GradeRequest;
  try {
    body = (await request.json()) as GradeRequest;
  } catch {
    return err("Body permintaan tidak valid", 400);
  }

  const { modelKey, question, images, systemPrompt } = body;
  const model = getModel(modelKey);
  if (!model) return err(`Model tidak dikenal: ${modelKey}`, 400);
  if (!question?.trim()) return err("Soal esai kosong", 400);
  if (!images?.length) return err("Tidak ada gambar lembar jawaban", 400);

  const client = new OpenAI({ apiKey, baseURL: "https://ai.sumopod.com/v1" });

  const imageContent = images.map((url) => ({
    type: "image_url" as const,
    image_url: { url },
  }));

  const systemMessage = systemPrompt?.trim() || DEFAULT_PROMPT;
  console.log("[grade] systemPrompt source:", systemPrompt?.trim() ? "user-edited" : "default");
  console.log("[grade] systemPrompt preview:", systemMessage.slice(0, 80).replace(/\n/g, "↵"));

  const start = performance.now();
  let res;
  try {
    res = await client.chat.completions.create({
      model: model.sumopodId,
      messages: [
        { role: "system", content: systemMessage },
        {
          role: "user",
          content: [{ type: "text", text: buildUserPrompt(question) }, ...imageContent],
        },
      ],
      tools: [GRADE_TOOL],
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

  const payload: GradeResponse = {
    extracted_text:  parsed.extracted_text  ?? "",
    extraction_note: parsed.extraction_note ?? "",
    score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, Math.round(parsed.score))) : 0,
    feedback_text:   parsed.feedback_text   ?? "",
    strengths:       Array.isArray(parsed.strengths)    ? parsed.strengths    : [],
    improvements:    Array.isArray(parsed.improvements) ? parsed.improvements : [],
    usage: {
      prompt_tokens:     res.usage?.prompt_tokens     ?? null,
      completion_tokens: res.usage?.completion_tokens ?? null,
      total_tokens:      res.usage?.total_tokens      ?? null,
    },
    latency,
  };

  return Response.json(payload);
}
