import { NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with",
  "is","was","are","were","be","been","have","has","had","do","does","did",
  "it","its","this","that","i","my","we","our","you","your",
  "이","가","을","를","은","는","에","의","로","으로","도","와","과",
  "하","고","이다","합니다","했습니다","있습니다","없습니다","했다","했어",
  "이건","이게","그","그게","다","더","안","못","잘","좀","너무","다시",
]);

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const uid = session.sub;

    const [
      totalRes, rhythmRes, patienceRes, lexiconRes,
      delegationRes, reflectionRes, breadthRes, abandonRes,
      shapeRes, quoteRes,
    ] = await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT s.id) AS n
         FROM sessions s JOIN devices d ON s.device_id = d.id
         WHERE d.user_id = $1 AND s.started_at >= NOW() - INTERVAL '28 days'`,
        [uid]
      ),
      pool.query(
        `SELECT EXTRACT(HOUR FROM t.ts)::int AS hr,
                COUNT(*) AS cnt,
                COUNT(*) FILTER (WHERE t.impact_score >= 4) AS hi_cnt
         FROM turns t
         JOIN sessions s ON t.session_id = s.id
         JOIN devices d ON s.device_id = d.id
         WHERE d.user_id = $1 AND t.ts >= NOW() - INTERVAL '28 days'
         GROUP BY hr ORDER BY cnt DESC`,
        [uid]
      ),
      pool.query(
        `SELECT ROUND(AVG(s.total_turns)) AS avg_turns
         FROM sessions s JOIN devices d ON s.device_id = d.id
         WHERE d.user_id = $1 AND s.started_at >= NOW() - INTERVAL '28 days'
           AND s.total_turns > 0`,
        [uid]
      ),
      pool.query(
        `SELECT t.impact_note
         FROM turns t
         JOIN sessions s ON t.session_id = s.id
         JOIN devices d ON s.device_id = d.id
         WHERE d.user_id = $1 AND t.ts >= NOW() - INTERVAL '28 days'
           AND t.impact_note IS NOT NULL AND length(t.impact_note) > 0`,
        [uid]
      ),
      pool.query(
        `SELECT ROUND(
           (COALESCE(SUM(agent_spawned), 0)::numeric /
           NULLIF(COUNT(DISTINCT t.session_id), 0)::numeric),
           1
         ) AS agent_per_session
         FROM turns t
         JOIN sessions s ON t.session_id = s.id
         JOIN devices d ON s.device_id = d.id
         WHERE d.user_id = $1 AND t.ts >= NOW() - INTERVAL '28 days'`,
        [uid]
      ),
      pool.query(
        `SELECT
           COUNT(DISTINCT t.session_id) FILTER (WHERE t.impact_score IS NOT NULL) AS scored,
           COUNT(DISTINCT s.id) AS total
         FROM sessions s
         JOIN devices d ON s.device_id = d.id
         LEFT JOIN turns t ON t.session_id = s.id
         WHERE d.user_id = $1 AND s.started_at >= NOW() - INTERVAL '28 days'`,
        [uid]
      ),
      pool.query(
        `SELECT ext, SUM(cnt) AS total
         FROM (
           SELECT (jsonb_each_text(file_exts)).key AS ext,
                  (jsonb_each_text(file_exts)).value::int AS cnt
           FROM turns t
           JOIN sessions s ON t.session_id = s.id
           JOIN devices d ON s.device_id = d.id
           WHERE d.user_id = $1 AND t.ts >= NOW() - INTERVAL '28 days'
             AND file_exts IS NOT NULL AND file_exts != 'null'::jsonb
             AND file_exts != '{}'::jsonb
         ) sub
         WHERE ext LIKE '.%'
         GROUP BY ext ORDER BY total DESC LIMIT 6`,
        [uid]
      ),
      pool.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE total_turns <= 3) AS quick
         FROM sessions s JOIN devices d ON s.device_id = d.id
         WHERE d.user_id = $1 AND s.started_at >= NOW() - INTERVAL '28 days'`,
        [uid]
      ),
      pool.query(
        `SELECT COALESCE(AVG(daily_s), 0) / 3600 AS avg_hours,
                COUNT(*) AS active_days
         FROM (
           SELECT DATE(t.ts) AS day,
                  SUM(COALESCE(t.session_duration_s, 0)) AS daily_s
           FROM turns t
           JOIN sessions s ON t.session_id = s.id
           JOIN devices d ON s.device_id = d.id
           WHERE d.user_id = $1 AND t.ts >= NOW() - INTERVAL '28 days'
           GROUP BY DATE(t.ts)
         ) daily`,
        [uid]
      ),
      pool.query(
        `SELECT t.impact_note, t.impact_score, t.session_id,
                TO_CHAR(t.ts AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS ts_label
         FROM turns t
         JOIN sessions s ON t.session_id = s.id
         JOIN devices d ON s.device_id = d.id
         WHERE d.user_id = $1 AND t.ts >= NOW() - INTERVAL '28 days'
           AND t.impact_note IS NOT NULL AND length(t.impact_note) > 0
           AND t.impact_score IS NOT NULL
         ORDER BY t.impact_score DESC, t.ts DESC LIMIT 1`,
        [uid]
      ),
    ]);

    const totalSessions = Number(totalRes.rows[0]?.n) || 0;

    // Rhythm: find peak 3-hour window
    const hourCounts = Array(24).fill(0);
    const hourHiCounts = Array(24).fill(0);
    for (const r of rhythmRes.rows) {
      hourCounts[r.hr] = Number(r.cnt);
      hourHiCounts[r.hr] = Number(r.hi_cnt);
    }
    let bestStart = -1, bestCount = 0;
    for (let h = 0; h < 24; h++) {
      const cnt = hourCounts[h] + hourCounts[(h + 1) % 24] + hourCounts[(h + 2) % 24];
      if (cnt > bestCount) { bestCount = cnt; bestStart = h; }
    }
    const hasTurns = hourCounts.some(c => c > 0);
    const peakStart = bestStart >= 0 ? bestStart : 10;
    const peakEnd = (peakStart + 3) % 24;
    const hiInWindow = hourHiCounts[peakStart] + hourHiCounts[(peakStart + 1) % 24] + hourHiCounts[(peakStart + 2) % 24];
    const totalHi = hourHiCounts.reduce((a, b) => a + b, 0);
    const hiWindowPct = totalHi > 0 ? Math.round((hiInWindow / totalHi) * 100) : null;

    // Lexicon: word frequency
    const wordFreq: Record<string, number> = {};
    for (const row of lexiconRes.rows) {
      const words = (row.impact_note as string).split(/[\s,.!?;:\-_/\\]+/).filter(w => w.length > 1);
      for (const w of words) {
        const lower = w.toLowerCase();
        if (!STOP_WORDS.has(lower)) wordFreq[lower] = (wordFreq[lower] || 0) + 1;
      }
    }
    const topWords = Object.entries(wordFreq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([word, n]) => ({ word, n }));
    const noteCount = lexiconRes.rows.length;

    const avgTurns = patienceRes.rows[0]?.avg_turns ? Number(patienceRes.rows[0].avg_turns) : null;
    const agentPerSession = delegationRes.rows[0]?.agent_per_session != null
      ? Number(delegationRes.rows[0].agent_per_session)
      : null;
    const scored = Number(reflectionRes.rows[0]?.scored) || 0;
    const reflTotal = Number(reflectionRes.rows[0]?.total) || 0;
    const reflectionPct = reflTotal > 0 ? Math.round((scored / reflTotal) * 100) : null;
    const extensions = breadthRes.rows.map(r => ({ ext: r.ext as string, n: Number(r.total) }));
    const totalSessAbandon = Number(abandonRes.rows[0]?.total) || 0;
    const quickSessions = Number(abandonRes.rows[0]?.quick) || 0;
    const avgHours = Number(shapeRes.rows[0]?.avg_hours) || null;
    const activeDays = Number(shapeRes.rows[0]?.active_days) || 0;

    const shapeStr = avgHours && avgHours > 0
      ? (() => {
          const h = Math.floor(avgHours);
          const m = Math.round((avgHours - h) * 60);
          return m > 0 ? `${h}h ${m}m` : `${h}h`;
        })()
      : null;

    const quote = quoteRes.rows[0] ?? null;

    return NextResponse.json({
      totalSessions,
      rhythm: {
        has: hasTurns,
        peakStart,
        peakEnd,
        hiWindowPct,
      },
      patience: { avgTurns },
      lexicon: { noteCount, topWords },
      delegation: { agentPerSession },
      reflection: { scored, total: reflTotal, pct: reflectionPct },
      breadth: { extensions },
      abandonment: { total: totalSessAbandon, quick: quickSessions },
      shape: { str: shapeStr, activeDays },
      quote,
    });
  } finally {
    await pool.end();
  }
}
