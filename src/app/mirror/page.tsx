import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Pool } from "@neondatabase/serverless";
import styles from "./mirror.module.css";

export const dynamic = "force-dynamic";

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with",
  "is","was","are","were","be","been","have","has","had","do","does","did",
  "it","its","this","that","i","my","we","our","you","your",
  "이","가","을","를","은","는","에","의","로","으로","도","와","과",
  "하","고","이다","합니다","했습니다","있습니다","없습니다","했다","했어",
  "이건","이게","그","그게","다","더","안","못","잘","좀","너무","다시",
]);

function nextSundayLabel() {
  const now = new Date();
  const dow = now.getDay();
  const daysUntil = dow === 0 ? 7 : 7 - dow;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntil);
  return `${next.getMonth() + 1}/${next.getDate()} 23:00 KST`;
}

export default async function MirrorPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let data: ReturnType<typeof buildData> | null = null;

  try {
    const uid = session.sub;
    const [
      totalRes, rhythmRes, patienceRes, lexiconRes,
      delegationRes, reflectionRes, breadthRes, abandonRes,
      shapeRes, quoteRes,
    ] = await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT s.id) AS n FROM sessions s
         JOIN devices d ON s.device_id = d.id
         WHERE d.user_id = $1 AND s.started_at >= NOW() - INTERVAL '28 days'`,
        [uid]
      ),
      pool.query(
        `SELECT EXTRACT(HOUR FROM t.ts)::int AS hr,
                COUNT(*) AS cnt,
                COUNT(*) FILTER (WHERE t.impact_score >= 4) AS hi_cnt
         FROM turns t JOIN sessions s ON t.session_id = s.id
         JOIN devices d ON s.device_id = d.id
         WHERE d.user_id = $1 AND t.ts >= NOW() - INTERVAL '28 days'
         GROUP BY hr`,
        [uid]
      ),
      pool.query(
        `SELECT ROUND(AVG(s.total_turns)) AS avg_turns FROM sessions s
         JOIN devices d ON s.device_id = d.id
         WHERE d.user_id = $1 AND s.started_at >= NOW() - INTERVAL '28 days'
           AND s.total_turns > 0`,
        [uid]
      ),
      pool.query(
        `SELECT t.impact_note FROM turns t
         JOIN sessions s ON t.session_id = s.id
         JOIN devices d ON s.device_id = d.id
         WHERE d.user_id = $1 AND t.ts >= NOW() - INTERVAL '28 days'
           AND t.impact_note IS NOT NULL AND length(t.impact_note) > 0`,
        [uid]
      ),
      pool.query(
        `SELECT ROUND(
           (COALESCE(SUM(agent_spawned), 0)::numeric /
           NULLIF(COUNT(DISTINCT t.session_id), 0)::numeric), 1
         ) AS agent_per_session
         FROM turns t JOIN sessions s ON t.session_id = s.id
         JOIN devices d ON s.device_id = d.id
         WHERE d.user_id = $1 AND t.ts >= NOW() - INTERVAL '28 days'`,
        [uid]
      ),
      pool.query(
        `SELECT
           COUNT(DISTINCT t.session_id) FILTER (WHERE t.impact_score IS NOT NULL) AS scored,
           COUNT(DISTINCT s.id) AS total
         FROM sessions s JOIN devices d ON s.device_id = d.id
         LEFT JOIN turns t ON t.session_id = s.id
         WHERE d.user_id = $1 AND s.started_at >= NOW() - INTERVAL '28 days'`,
        [uid]
      ),
      pool.query(
        `SELECT ext, SUM(cnt) AS total FROM (
           SELECT (jsonb_each_text(file_exts)).key AS ext,
                  (jsonb_each_text(file_exts)).value::int AS cnt
           FROM turns t JOIN sessions s ON t.session_id = s.id
           JOIN devices d ON s.device_id = d.id
           WHERE d.user_id = $1 AND t.ts >= NOW() - INTERVAL '28 days'
             AND file_exts IS NOT NULL AND file_exts != 'null'::jsonb
             AND file_exts != '{}'::jsonb
         ) sub WHERE ext LIKE '.%'
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
           SELECT DATE(t.ts) AS day, SUM(COALESCE(t.session_duration_s, 0)) AS daily_s
           FROM turns t JOIN sessions s ON t.session_id = s.id
           JOIN devices d ON s.device_id = d.id
           WHERE d.user_id = $1 AND t.ts >= NOW() - INTERVAL '28 days'
           GROUP BY DATE(t.ts)
         ) daily`,
        [uid]
      ),
      pool.query(
        `SELECT t.impact_note, t.impact_score, t.session_id,
                TO_CHAR(t.ts AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS ts_label
         FROM turns t JOIN sessions s ON t.session_id = s.id
         JOIN devices d ON s.device_id = d.id
         WHERE d.user_id = $1 AND t.ts >= NOW() - INTERVAL '28 days'
           AND t.impact_note IS NOT NULL AND length(t.impact_note) > 0
           AND t.impact_score IS NOT NULL
         ORDER BY t.impact_score DESC, t.ts DESC LIMIT 1`,
        [uid]
      ),
    ]);

    data = buildData(
      totalRes, rhythmRes, patienceRes, lexiconRes,
      delegationRes, reflectionRes, breadthRes, abandonRes,
      shapeRes, quoteRes
    );
  } finally {
    await pool.end();
  }

  if (!data) return <div className="page">데이터를 불러올 수 없습니다.</div>;

  const { totalSessions, rhythm, patience, lexicon, delegation,
          reflection, breadth, abandonment, shape, quote } = data;

  const observations = [
    {
      id: "rhythm",
      section: "시간의 리듬",
      stat: rhythm.has ? `${rhythm.peakStart}–${rhythm.peakEnd}` : "—",
      unit: rhythm.has ? "시" : "",
      headline: rhythm.has
        ? `당신의 깊은 작업은 ${rhythm.peakStart}시에서 ${rhythm.peakEnd}시 사이에 있습니다.`
        : "아직 충분한 데이터가 없습니다.",
      body: rhythm.hiWindowPct
        ? `지난 4주, 임팩트 4·5점 세션의 ${rhythm.hiWindowPct}%가 ${rhythm.peakStart}시에서 ${rhythm.peakEnd}시 사이에 시작됐습니다. 이 세 시간 구간이 당신의 집중 정점입니다. 데이터가 쌓일수록 더 선명해집니다.`
        : "지난 4주의 턴 기록이 쌓이면 당신의 최적 집중 시간대를 분석할 수 있습니다.",
      chips: undefined as { label: string; n: number }[] | undefined,
    },
    {
      id: "patience",
      section: "인내심",
      stat: patience.avgTurns ? String(patience.avgTurns) : "—",
      unit: patience.avgTurns ? "턴" : "",
      headline: patience.avgTurns
        ? `한 가지를 평균 ${patience.avgTurns}턴까지 붙듭니다.`
        : "세션 데이터 수집 중입니다.",
      body: patience.avgTurns
        ? `세션당 평균 ${patience.avgTurns}턴 — 한 번 시작한 가설은 충분히 끌어봅니다. 끈기와 효율 사이의 균형선이 보이기 시작합니다.`
        : "세션 데이터가 쌓이면 당신의 집중 지속력을 분석합니다.",
      chips: undefined,
    },
    {
      id: "lexicon",
      section: "당신의 어휘",
      stat: lexicon.noteCount > 0 ? String(lexicon.noteCount) : "—",
      unit: lexicon.noteCount > 0 ? "노트" : "",
      headline: lexicon.noteCount > 0
        ? "임팩트 노트에 자주 나오는 단어들."
        : "아직 임팩트 노트가 없습니다.",
      body: lexicon.noteCount > 0
        ? `${lexicon.noteCount}건의 임팩트 노트를 펼쳐보니 이런 단어들이 반복됩니다. 동사의 결이 당신이 어떤 일에서 의미를 찾는지 보여줍니다.`
        : "세션 종료 시 임팩트 점수와 한 줄 메모를 남기면 당신만의 어휘 패턴을 분석합니다.",
      chips: lexicon.topWords.length > 0
        ? lexicon.topWords.map(w => ({ label: w.word, n: w.n }))
        : undefined,
    },
    {
      id: "delegation",
      section: "위임의 거리",
      stat: delegation.agentPerSession !== null ? String(delegation.agentPerSession) : "—",
      unit: delegation.agentPerSession !== null ? "/ 세션" : "",
      headline: delegation.agentPerSession !== null
        ? delegation.agentPerSession < 1
          ? "에이전트를 자주 부르지 않습니다."
          : `세션마다 에이전트를 ${delegation.agentPerSession}번 씁니다.`
        : "에이전트 데이터 수집 중.",
      body: delegation.agentPerSession !== null
        ? `세션당 평균 ${delegation.agentPerSession}번 에이전트를 부릅니다. ${
            delegation.agentPerSession < 1
              ? "대부분의 작업을 직접 따라가고 싶어합니다. 통제와 이해를 효율보다 약간 더 중요하게 두는 패턴입니다."
              : "에이전트를 적극적으로 활용하는 편입니다. 분해와 위임으로 복잡한 작업을 다루는 스타일입니다."
          }`
        : "에이전트 사용 데이터가 쌓이면 위임 패턴을 분석합니다.",
      chips: undefined,
    },
    {
      id: "reflection",
      section: "반성의 습관",
      stat: reflection.pct !== null ? `${reflection.pct}` : "—",
      unit: reflection.pct !== null ? "%" : "",
      headline: reflection.pct !== null
        ? `${reflection.pct >= 40 ? "절반 가까운" : `${reflection.pct}%의`} 세션에 점수를 직접 남깁니다.`
        : "아직 임팩트 점수가 없습니다.",
      body: reflection.pct !== null
        ? `${reflection.scored}개 세션에 임팩트 점수를 남겼습니다. 자기가 한 일을 그냥 흘려보내지 않는 습관 — 한 줄 메모를 남기는 데 30초가 들지만, 다음 결정을 더 좋게 만드는 종류의 노력입니다.`
        : "세션 종료 시 1–5점 임팩트 점수를 매기면 반성 습관 지표가 활성화됩니다.",
      chips: undefined,
    },
    {
      id: "breadth",
      section: "관심의 너비",
      stat: breadth.extensions.length > 0 ? String(breadth.extensions.length) : "—",
      unit: breadth.extensions.length > 0 ? "언어" : "",
      headline: breadth.extensions.length > 0
        ? `${breadth.extensions.length}개의 언어 위에서 살고 있습니다.`
        : "파일 확장자 데이터 수집 중.",
      body: breadth.extensions.length > 0
        ? `${breadth.extensions.map(e => e.ext).join(", ")} — 한 영역에 갇히는 사람은 아닙니다. 호기심의 폭이 있지만 산만하지는 않습니다.`
        : "최신 Claude Code 클라이언트가 설치되면 작업한 파일 언어를 분석합니다.",
      chips: breadth.extensions.length > 0
        ? breadth.extensions.map(e => ({ label: e.ext, n: e.n }))
        : undefined,
    },
    {
      id: "abandonment",
      section: "포기의 속도",
      stat: abandonment.total > 0 ? `${abandonment.quick}/${abandonment.total}` : "—",
      unit: abandonment.total > 0 ? "롤백" : "",
      headline: abandonment.total > 0
        ? `${abandonment.total}번 중 ${abandonment.quick}번은 빠르게 접었습니다.`
        : "세션 데이터 수집 중.",
      body: abandonment.total > 0
        ? `짧은 세션(3턴 이하)이 전체의 ${Math.round((abandonment.quick / abandonment.total) * 100)}% — 잘못된 길에서 빠져나오는 속도입니다. 매몰 비용에 덜 휘둘리는 패턴입니다.`
        : "세션 기록이 쌓이면 빠른 방향 전환 패턴을 분석합니다.",
      chips: undefined,
    },
    {
      id: "shape",
      section: "하루의 형태",
      stat: shape.str ?? "—",
      unit: "",
      headline: shape.str
        ? `하루 평균 ${shape.str}을 코드 안에 보냅니다.`
        : "일별 사용 데이터 수집 중.",
      body: shape.str
        ? `총합이 아닙니다 — 직접 손이 닿은 세션의 합계입니다. ${shape.activeDays}일 동안의 데이터, 일정한 양, 일정한 리듬.`
        : "세션 시간 데이터가 쌓이면 하루의 형태를 그릴 수 있습니다.",
      chips: undefined,
    },
  ];

  return (
    <div className="page" style={{ maxWidth: 920 }}>
      {/* breadcrumb */}
      <div className="breadcrumb">
        <a href="/">대시보드</a>
        <span className="sep">/</span>
        <span>거울</span>
      </div>

      {/* opening */}
      <div style={{ paddingTop: 24, paddingBottom: 64 }}>
        <div className="label" style={{ marginBottom: 24, letterSpacing: "0.12em" }}>
          거울 · 지난 4주 · {totalSessions}개 세션
        </div>
        <h1 style={{
          fontFamily: "var(--font-serif)",
          fontWeight: 400,
          fontSize: 52,
          lineHeight: 1.05,
          letterSpacing: "-0.025em",
          margin: 0,
          maxWidth: 680,
        }}>
          당신이 코드를 쓰는 방식이,{" "}
          <span style={{ fontStyle: "italic", color: "var(--ink-3)" }}>
            당신에 대해 말해주는 것들.
          </span>
        </h1>
        <p style={{
          fontFamily: "var(--font-serif)",
          fontSize: 17,
          lineHeight: 1.6,
          color: "var(--ink-2)",
          marginTop: 28,
          maxWidth: 580,
        }}>
          {totalSessions}개의 세션을 모았습니다. 비용과 토큰의 숫자 뒤에는 시간대의
          선택, 끈기의 길이, 단어의 결, 위임의 거리 같은 것이 있었습니다. 데이터가
          자기 자랑이나 자기 비판으로 변하지 않게 — 다만 거울로 만들어 보았습니다.
        </p>
        <div style={{
          marginTop: 32,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--ink-4)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}>
          {observations.length}개의 관찰
          <span style={{ margin: "0 12px", color: "var(--ink-5)" }}>·</span>
          스크롤하여 읽기 ↓
        </div>
      </div>

      {/* observations */}
      {observations.map((obs, i) => (
        <div key={obs.id} className={styles.observation}>
          <div
            className={styles.obsGrid}
            style={{ gridTemplateColumns: i % 2 === 1 ? "1fr 280px" : "280px 1fr" }}
          >
            {/* stat column */}
            <div style={{
              order: i % 2 === 1 ? 2 : 1,
              textAlign: i % 2 === 1 ? "right" : "left",
            }}>
              <div className="mono" style={{
                fontSize: 10.5, color: "var(--ink-4)", letterSpacing: "0.08em",
                textTransform: "uppercase", marginBottom: 20,
              }}>
                № {String(i + 1).padStart(2, "0")} · {obs.section}
              </div>
              <div style={{
                display: "flex", alignItems: "baseline", gap: 10,
                justifyContent: i % 2 === 1 ? "flex-end" : "flex-start",
                flexWrap: "wrap",
              }}>
                <span style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: obs.stat.length > 4 ? 56 : 80,
                  fontWeight: 400,
                  letterSpacing: "-0.03em",
                  lineHeight: 0.9,
                  color: "var(--ink)",
                  whiteSpace: "nowrap",
                }}>
                  {obs.stat}
                </span>
                {obs.unit && (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 18, color: "var(--ink-3)" }}>
                    {obs.unit}
                  </span>
                )}
              </div>

              {obs.chips && (
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: 6, marginTop: 24,
                  justifyContent: i % 2 === 1 ? "flex-end" : "flex-start",
                }}>
                  {obs.chips.map((c, ci) => (
                    <span key={ci} style={{
                      display: "inline-flex", alignItems: "baseline", gap: 6,
                      padding: "4px 9px",
                      background: "var(--bg-2)",
                      border: "1px solid var(--line-hair)",
                      borderRadius: 3,
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--ink-2)",
                    }}>
                      <span style={{ fontFamily: "var(--font-serif)", fontSize: 13 }}>{c.label}</span>
                      <span style={{ color: "var(--ink-4)" }}>×{c.n}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* prose column */}
            <div style={{ order: i % 2 === 1 ? 1 : 2, maxWidth: 520 }}>
              <h2 style={{
                fontFamily: "var(--font-serif)",
                fontWeight: 400,
                fontSize: 26,
                lineHeight: 1.2,
                letterSpacing: "-0.015em",
                margin: 0,
                color: "var(--ink)",
              }}>
                {obs.headline}
              </h2>
              <p style={{
                fontFamily: "var(--font-serif)",
                fontSize: 16,
                lineHeight: 1.65,
                color: "var(--ink-2)",
                margin: "18px 0 0",
              }}>
                {obs.body}
              </p>
            </div>
          </div>
        </div>
      ))}

      {/* closing quote */}
      {quote && (
        <div style={{
          marginTop: 64,
          paddingTop: 56,
          paddingBottom: 80,
          borderTop: "1px solid var(--line-soft)",
          textAlign: "center",
        }}>
          <div className="label" style={{ marginBottom: 32 }}>
            지난 주, 당신이 직접 남긴 가장 무거운 한 줄
          </div>
          <blockquote style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontWeight: 400,
            fontSize: 28,
            lineHeight: 1.3,
            letterSpacing: "-0.01em",
            color: "var(--ink)",
            margin: 0,
            padding: "0 32px",
          }}>
            &ldquo;{quote.impact_note}&rdquo;
          </blockquote>
          <div style={{
            marginTop: 24,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--ink-3)",
            letterSpacing: "0.04em",
          }}>
            — {quote.ts_label} · 임팩트 {quote.impact_score}/5
          </div>
          <div style={{ marginTop: 48 }}>
            <a
              href={`/sessions/${quote.session_id}`}
              style={{
                display: "inline-block",
                background: "transparent",
                border: "1px solid var(--line-soft)",
                padding: "10px 18px",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                letterSpacing: "0.02em",
                borderRadius: 3,
                color: "var(--ink-2)",
                cursor: "pointer",
              }}
            >
              이 세션 보기 →
            </a>
          </div>
        </div>
      )}

      {/* footer */}
      <div style={{
        paddingTop: 32,
        borderTop: "1px solid var(--line-hair)",
        textAlign: "center",
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        color: "var(--ink-4)",
        letterSpacing: "0.06em",
      }}>
        거울은 매주 일요일 밤에 다시 그려집니다 · 다음 갱신 {nextSundayLabel()}
      </div>
    </div>
  );
}

// ── Data processing ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildData(...results: any[]) {
  const [
    totalRes, rhythmRes, patienceRes, lexiconRes,
    delegationRes, reflectionRes, breadthRes, abandonRes,
    shapeRes, quoteRes,
  ] = results;

  const totalSessions = Number(totalRes.rows[0]?.n) || 0;

  const hourCounts = Array(24).fill(0);
  const hourHiCounts = Array(24).fill(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of rhythmRes.rows as any[]) {
    hourCounts[r.hr] = Number(r.cnt);
    hourHiCounts[r.hr] = Number(r.hi_cnt);
  }
  let bestStart = 10, bestCount = 0;
  for (let h = 0; h < 24; h++) {
    const cnt = hourCounts[h] + hourCounts[(h + 1) % 24] + hourCounts[(h + 2) % 24];
    if (cnt > bestCount) { bestCount = cnt; bestStart = h; }
  }
  const hasTurns = hourCounts.some(c => c > 0);
  const peakEnd = (bestStart + 3) % 24;
  const hiInWindow = hourHiCounts[bestStart] + hourHiCounts[(bestStart + 1) % 24] + hourHiCounts[(bestStart + 2) % 24];
  const totalHi = hourHiCounts.reduce((a: number, b: number) => a + b, 0);
  const hiWindowPct = totalHi > 0 ? Math.round((hiInWindow / totalHi) * 100) : null;

  const wordFreq: Record<string, number> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of lexiconRes.rows as any[]) {
    const words = (row.impact_note as string).split(/[\s,.!?;:\-_/\\]+/).filter((w: string) => w.length > 1);
    for (const w of words) {
      const lower = w.toLowerCase();
      if (!STOP_WORDS.has(lower)) wordFreq[lower] = (wordFreq[lower] || 0) + 1;
    }
  }
  const topWords = Object.entries(wordFreq)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 6)
    .map(([word, n]) => ({ word, n: n as number }));
  const noteCount = lexiconRes.rows.length;

  const avgHours = Number(shapeRes.rows[0]?.avg_hours) || null;
  const activeDays = Number(shapeRes.rows[0]?.active_days) || 0;
  const shapeStr = avgHours && avgHours > 0
    ? (() => {
        const h = Math.floor(avgHours);
        const m = Math.round((avgHours - h) * 60);
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
      })()
    : null;

  return {
    totalSessions,
    rhythm: { has: hasTurns, peakStart: bestStart, peakEnd, hiWindowPct },
    patience: { avgTurns: patienceRes.rows[0]?.avg_turns ? Number(patienceRes.rows[0].avg_turns) : null },
    lexicon: { noteCount, topWords },
    delegation: {
      agentPerSession: delegationRes.rows[0]?.agent_per_session != null
        ? Number(delegationRes.rows[0].agent_per_session)
        : null,
    },
    reflection: {
      scored: Number(reflectionRes.rows[0]?.scored) || 0,
      total: Number(reflectionRes.rows[0]?.total) || 0,
      pct: Number(reflectionRes.rows[0]?.total) > 0
        ? Math.round((Number(reflectionRes.rows[0].scored) / Number(reflectionRes.rows[0].total)) * 100)
        : null,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    breadth: { extensions: (breadthRes.rows as any[]).map((r: any) => ({ ext: r.ext as string, n: Number(r.total) })) },
    abandonment: {
      total: Number(abandonRes.rows[0]?.total) || 0,
      quick: Number(abandonRes.rows[0]?.quick) || 0,
    },
    shape: { str: shapeStr, activeDays },
    quote: quoteRes.rows[0] ?? null,
  };
}
