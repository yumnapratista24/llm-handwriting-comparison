import OpenAI from "openai";
import { getModel, type GradeResponse } from "@/lib/models";
import { buildTutorGrounding, buildTutorSystemPrompt } from "@/lib/prompt";

export const runtime = "nodejs";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  modelKey: string;
  question: string;
  grade: GradeResponse;
  messages: ChatMessage[];
}

function err(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const apiKey = process.env.SUMOPOD_API_KEY;
  if (!apiKey) return err("SUMOPOD_API_KEY belum diset di .env.local", 500);

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return err("Body permintaan tidak valid", 400);
  }

  const { modelKey, question, grade, messages } = body;
  const model = getModel(modelKey);
  if (!model) return err(`Model tidak dikenal: ${modelKey}`, 400);
  if (!question?.trim() || !grade) return err("Konteks diskusi kosong", 400);

  const history: ChatMessage[] = Array.isArray(messages) ? messages : [];
  // turnCount is the turn we're about to produce: 1-based, clamped to the 3-turn rule.
  const priorTutorTurns = history.filter((m) => m.role === "assistant").length;
  const turnCount = Math.min(priorTutorTurns + 1, 3);

  const systemMessage = buildTutorSystemPrompt(
    buildTutorGrounding(question, grade),
    turnCount,
  );

  // Turn 1 has no student input yet — kick the model off explicitly.
  const chatMessages = history.length
    ? history
    : [{ role: "user" as const, content: "Mulai diskusi." }];

  const client = new OpenAI({ apiKey, baseURL: "https://ai.sumopod.com/v1" });

  let res;
  try {
    res = await client.chat.completions.create({
      model: model.sumopodId,
      messages: [{ role: "system", content: systemMessage }, ...chatMessages],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Panggilan ke SumoPod gagal";
    console.error("[chat] SumoPod error:", message);
    const status = /\b4\d\d\b/.exec(message)?.[0];
    return err(message, status ? Number(status) : 502);
  }

  const reply = res.choices?.[0]?.message?.content?.trim();
  if (!reply) return err("Model tidak mengembalikan balasan", 502);

  return Response.json({ reply });
}
