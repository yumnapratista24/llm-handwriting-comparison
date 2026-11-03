import { openRouterCompletions } from "@/lib/tutor/llm";
import { findSession, getOrCreateSession, TutorError } from "@/lib/tutor/tutorService";

export const runtime = "nodejs";

interface SessionRequest {
  resultId?: string;
}

function err(message: string, status: number, code?: string) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

export async function GET(request: Request) {
  const resultId = new URL(request.url).searchParams.get("resultId")?.trim();
  if (!resultId) return err("resultId wajib diisi", 400);
  try {
    const session = await findSession(resultId);
    return session ? Response.json(session) : err("Sesi tutoring belum ada", 404, "not_found");
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gagal memuat sesi tutoring";
    console.error("[tutor/session]", message);
    return err(`Gagal memuat sesi tutoring: ${message}`, 502);
  }
}

export async function POST(request: Request) {
  let body: SessionRequest;
  try {
    body = (await request.json()) as SessionRequest;
  } catch {
    return err("Body permintaan tidak valid", 400);
  }
  const resultId = body.resultId?.trim();
  if (!resultId) return err("resultId wajib diisi", 400);

  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    return Response.json(await getOrCreateSession(resultId, apiKey ? openRouterCompletions(apiKey) : null));
  } catch (e) {
    if (e instanceof TutorError) return err(e.message, e.status, e.code);
    const message = e instanceof Error ? e.message : "Gagal memuat sesi tutoring";
    console.error("[tutor/session]", message);
    return err(`Gagal memuat sesi tutoring: ${message}`, 502);
  }
}
