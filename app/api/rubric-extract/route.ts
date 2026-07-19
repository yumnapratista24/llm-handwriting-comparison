import OpenAI from "openai";
import { getModel } from "@/lib/models";
import {
  buildRubricExtractionTool,
  normalizeRubric,
  RUBRIC_EXTRACTION_INSTRUCTIONS,
  type RubricCriterion,
} from "@/lib/prompt";
import { extractText } from "@/lib/rag";

export const runtime = "nodejs";

const EXTRACTION_MODEL_KEY = "gemini35";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function err(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export async function POST(request: Request) {
  const apiKey = process.env.SUMOPOD_API_KEY;
  if (!apiKey) return err("SUMOPOD_API_KEY belum diset di .env.local", 500);

  const model = getModel(EXTRACTION_MODEL_KEY);
  if (!model) return err("Model ekstraksi tidak ditemukan", 500);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err("Body permintaan tidak valid", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return err("Tidak ada berkas rubrik", 400);

  const filename = file.name;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const buffer = Buffer.from(await file.arrayBuffer());

  let content: ContentPart[];
  if (["pdf", "doc", "docx"].includes(ext)) {
    let text: string;
    try {
      text = (await extractText(ext, buffer)).trim();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Ekstraksi teks gagal";
      console.error("[rubric-extract] extractText:", message);
      return err(`Gagal membaca berkas: ${message}`, 502);
    }
    if (!text) {
      return err(
        "Tidak ada teks yang bisa dibaca dari berkas ini (mungkin PDF hasil pindai). Coba unggah foto/tangkapan layar rubrik.",
        422,
      );
    }
    content = [{ type: "text", text }];
  } else if (ext in IMAGE_MIME) {
    const dataUrl = `data:${IMAGE_MIME[ext]};base64,${buffer.toString("base64")}`;
    content = [{ type: "image_url", image_url: { url: dataUrl } }];
  } else {
    return err("Format tidak didukung — gunakan PDF, DOC, DOCX, PNG, JPG, atau WEBP", 400);
  }

  const client = new OpenAI({ apiKey, baseURL: "https://ai.sumopod.com/v1" });

  let res;
  try {
    res = await client.chat.completions.create({
      model: model.sumopodId,
      messages: [
        { role: "system", content: RUBRIC_EXTRACTION_INSTRUCTIONS },
        {
          role: "user",
          content: [
            { type: "text" as const, text: "Transcribe the rubric from the following content:" },
            ...content,
          ],
        },
      ],
      tools: [buildRubricExtractionTool()],
      tool_choice: { type: "function", function: { name: "extract_rubric" } },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Panggilan ke SumoPod gagal";
    console.error("[rubric-extract] SumoPod error:", message);
    const status = /\b4\d\d\b/.exec(message)?.[0];
    return err(message, status ? Number(status) : 502);
  }

  const toolCall = res.choices?.[0]?.message?.tool_calls?.[0];
  const args = toolCall?.type === "function" ? toolCall.function.arguments : undefined;
  if (!args) return err("Model tidak mengembalikan hasil ekstraksi (extract_rubric)", 502);

  let parsed: { criteria?: RubricCriterion[] };
  try {
    parsed = JSON.parse(args);
  } catch {
    return err("Hasil extract_rubric bukan JSON valid", 502);
  }

  const criteria = Array.isArray(parsed.criteria) ? parsed.criteria : [];
  if (!criteria.length) {
    return err("Tidak ditemukan struktur rubrik yang valid pada berkas ini", 422);
  }

  return Response.json({ criteria: normalizeRubric(criteria) });
}
