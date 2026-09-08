import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { maybeDistil } from "@/lib/taste";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What Riff thinks your taste is, and the evidence it inferred it from. Readable
// and clearable, because a preference you cannot see or correct is just a bias.
export async function GET() {
  const p = await store.getPrefs();
  return NextResponse.json({
    note: p.note,
    signals: p.signals.length,
    recent: p.signals.slice(-8).map((s) => ({ kind: s.kind, text: s.text })),
    updatedAt: p.updatedAt,
  });
}

// PUT { note } to correct it, { reset: true } to forget everything, or
// { distil: true } to re-read the evidence now instead of waiting for more.
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body?.distil) {
    const p = await maybeDistil(true);
    return NextResponse.json({ note: p?.note ?? "", signals: p?.signals.length ?? 0 });
  }
  const p = await store.mutatePrefs((cur) => {
    if (body?.reset) { cur.signals = []; cur.distilledAt = 0; cur.note = ""; return; }
    if (typeof body?.note === "string") { cur.note = body.note.slice(0, 600); cur.distilledAt = cur.signals.length; }
  });
  return NextResponse.json({ note: p.note, signals: p.signals.length });
}
