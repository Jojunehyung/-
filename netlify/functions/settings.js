// GET  /api/settings?dept=  → { settings }  (로그인 토큰 또는 x-ingest-key)
// POST /api/settings?dept=  { node, values } → 병합 저장 (로그인 토큰만)
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
function ingestOk(req) {
  const need = process.env.INGEST_KEY || "";
  return need && (req.headers.get("x-ingest-key") || "") === need;
}

export default async (req) => {
  const dept = new URL(req.url).searchParams.get("dept") || "lead";
  const store = getStore({ name: "dashboard", consistency: "strong" });
  const key = `settings:${dept}`;

  if (req.method === "GET") {
    if (!authed(req) && !ingestOk(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
    const settings = (await store.get(key, { type: "json" })) || {};
    return Response.json({ settings });
  }

  if (req.method === "POST") {
    if (!authed(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
    let body = {};
    try { body = await req.json(); } catch { /* noop */ }
    if (!body.node || typeof body.values !== "object") {
      return Response.json({ error: "bad request" }, { status: 400 });
    }
    const cur = (await store.get(key, { type: "json" })) || {};
    cur[body.node] = { ...(cur[body.node] || {}), ...body.values };
    await store.setJSON(key, cur);
    return Response.json({ ok: true });
  }

  return new Response("Method Not Allowed", { status: 405 });
};

export const config = { path: "/api/settings" };
