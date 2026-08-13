import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { humanCorrections } from "../../../db/schema";

const actions = new Set(["adjusted", "approved", "rejected"]);

export async function GET() {
  try {
    const corrections = await getDb()
      .select()
      .from(humanCorrections)
      .orderBy(desc(humanCorrections.createdAt))
      .limit(250);
    return Response.json({ corrections });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load corrections" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const candidateCutId = typeof body.candidate_cut_id === "string" ? body.candidate_cut_id.trim() : "";
    const humanAction = typeof body.human_action === "string" ? body.human_action : "";
    const aiStart = Number(body.ai_start);
    const aiEnd = Number(body.ai_end);
    const humanStart = Number(body.human_start);
    const humanEnd = Number(body.human_end);

    if (!candidateCutId || !actions.has(humanAction)) {
      return Response.json({ error: "candidate_cut_id and a valid human_action are required" }, { status: 400 });
    }
    if (![aiStart, aiEnd, humanStart, humanEnd].every(Number.isFinite) || humanEnd <= humanStart) {
      return Response.json({ error: "Cut boundaries must be finite and ordered" }, { status: 400 });
    }

    const correction = {
      id: crypto.randomUUID(),
      candidateCutId,
      aiStart,
      aiEnd,
      humanStart,
      humanEnd,
      humanAction: humanAction as "adjusted" | "approved" | "rejected",
      reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : "",
    };
    await getDb().insert(humanCorrections).values(correction);
    return Response.json({ correction }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save correction" }, { status: 500 });
  }
}
