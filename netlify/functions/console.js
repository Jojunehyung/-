// GET /api/console → { runs: {부서: [...]}, settings: {부서: {...}} }
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

const DEPT_IDS = ["lead"]; // 가동 부서가 늘면 추가

export default async (req) => {
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  if (!authed(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const store = getStore({ name: "dashboard", consistency: "strong" });
  const runs = {}, settings = {};
  for (const id of DEPT_IDS) {
    runs[id] = (await store.get(`runs:${id}`, { type: "json" })) || [];
    settings[id] = (await store.get(`settings:${id}`, { type: "json" })) || {};
  }
  return Response.json({ runs, settings });
};

export const config = { path: "/api/console" };
