// GET  /api/opps            → { items: [...], updated_at }   (종합점수순)
// POST /api/opps  {id,status} → 상태 변경 (new/interested/applied/skipped)
import { createHmac, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

function authed(req) {
  const t = (req.headers.get("authorization") || "").replace("Bearer ", "");
  const [exp, sig] = t.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const pw = process.env.ADMIN_PASSWORD || "";
  const good = createHmac("sha256", process.env.AUTH_SECRET || pw).update(exp).digest("base64url");
  try { return timingSafeEqual(Buffer.from(sig), Buffer.from(good)); } catch { return false; }
}

const total = (o) => {
  const a = o.analysis || {};
  if (Number.isInteger(a.total_score)) return a.total_score;
  if (Number.isInteger(a.fit_score)) return a.fit_score;
  return -1;
};

export default async (req) => {
  if (!authed(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const store = getStore({ name: "dashboard", consistency: "strong" });
  const data = (await store.get("opps", { type: "json" })) || { items: {} };

  if (req.method === "GET") {
    const items = Object.values(data.items).sort((a, b) => (total(b) - total(a)) || ((b.budget_manwon || 0) - (a.budget_manwon || 0)));
    return Response.json({ items, updated_at: data.updated_at || null });
  }

  if (req.method === "POST") {
    let body = {};
    try { body = await req.json(); } catch { /* noop */ }
    const ok = ["new", "interested", "applied", "skipped"];
    if (!data.items[body.id] || !ok.includes(body.status)) {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    data.items[body.id].status = body.status;
    await store.setJSON("opps", data);
    return Response.json({ ok: true });
  }

  if (req.method === "DELETE") {
    let body = {};
    try { body = await req.json(); } catch { /* noop */ }
    if (!body.id || !data.items[body.id]) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    delete data.items[body.id];
    await store.setJSON("opps", data);
    return Response.json({ ok: true });
  }

  return new Response("Method Not Allowed", { status: 405 });
};

export const config = { path: "/api/opps" };
