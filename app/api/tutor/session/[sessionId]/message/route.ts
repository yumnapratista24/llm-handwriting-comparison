import { openRouterLlm } from "@/lib/tutor/llm";
import { runTutorTurn, TutorError } from "@/lib/tutor/tutorService";

export const runtime = "nodejs";

interface MessageRequest {
  content?: string;
  gapId?: string;
}

function err(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return err("OPENROUTER_API_KEY belum diset di environment server (lokal: .env.local, deployment: Environment Variables)", 500);

  const { sessionId } = await params;

  let body: MessageRequest;
  try {
    body = (await request.json()) as MessageRequest;
  } catch {
    return err("Body permintaan tidak valid", 400);
  }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return err("Pesan kosong", 400);

  try {
    return Response.json(await runTutorTurn(
      sessionId,
      content,
      openRouterLlm(apiKey),
      typeof body.gapId === "string" ? body.gapId : null,
    ));
  } catch (e) {
    if (e instanceof TutorError) return err(e.message, e.status);
    const message = e instanceof Error ? e.message : "Panggilan ke OpenRouter gagal";
    console.error("[tutor/message]", message);
    const status = /\b4\d\d\b/.exec(message)?.[0];
    return err(message, status ? Number(status) : 502);
  }
}
