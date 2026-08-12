// 수집기(GitHub Actions의 파이썬)가 호출하는 전용 엔드포인트. 헤더 x-ingest-key 로 인증.
// GET  /api/ingest                     → { ids: [...] }   (중복 분석 방지용 기존 id 목록)
// POST /api/ingest {items, profile?}   → 병합 저장. 기존 항목의 status·최초발견일은 보존.
import { getStore } from "@netlify/blobs";

// 한국 표준시(KST) 문자열. Netlify 서버는 UTC라 +9 변환.
function kstNow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().replace("T", " ").slice(0, 16); // "YYYY-MM-DD HH:MM"
}
function kstISO() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString();
}

function keyOk(req) {
  const need = process.env.INGEST_KEY || "";
  return need && (req.headers.get("x-ingest-key") || "") === need;
}

export default async (req) => {
  if (!keyOk(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const store = getStore("dashboard");
  const data = (await store.get("opps", { type: "json" })) || { items: {} };

  if (req.method === "GET") {
    return Response.json({ ids: Object.keys(data.items) });
  }

  if (req.method === "POST") {
    let body = {};
    try { body = await req.json(); } catch { /* noop */ }
    const incoming = Array.isArray(body.items) ? body.items : [];
    let added = 0;
    const now = kstISO();

    // 정책: 수집기는 공고를 추가·갱신만 한다. 원본이 플랫폼에서 내려가도 자동 삭제하지 않는다.
    // 공고 삭제는 오직 대표가 공고함/콘솔에서 🗑 삭제를 눌렀을 때만 일어난다 (DELETE /api/opps).
    for (const it of incoming) {
      if (!it || !it.id) continue;
      const prev = data.items[it.id];
      data.items[it.id] = {
        ...it,
        status: prev?.status || "new",          // 대표가 누른 상태는 절대 덮어쓰지 않음
        first_seen: prev?.first_seen || now,
      };
      if (!prev) added += 1;
    }
    data.updated_at = now;
    await store.setJSON("opps", data);

    if (body.profile) await store.setJSON("profile", body.profile); // AI 상담 컨텍스트용

    // 수집기의 실행 요약 → 콘솔 실행 이력에 기록
    if (body.run && body.run.dept) {
      const rkey = `runs:${body.run.dept}`;
      const runs = (await store.get(rkey, { type: "json" })) || [];
      runs.unshift({ t: body.run.t || kstNow().slice(5),
        ok: body.run.ok !== false, note: body.run.note || "", counts: body.run.counts || {} });
      await store.setJSON(rkey, runs.slice(0, 20));
    }
    return Response.json({ ok: true, added, total: Object.keys(data.items).length });
  }

  return new Response("Method Not Allowed", { status: 405 });
};

export const config = { path: "/api/ingest" };
