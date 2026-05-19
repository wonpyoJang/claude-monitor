@AGENTS.md

# Claude Monitor — 프로젝트 지침

## 스택 요약

- **프레임워크**: Next.js 16 App Router (서버 컴포넌트 기본, `"use client"` 최소화)
- **DB**: Neon PostgreSQL (`@neondatabase/serverless` Pool)
- **인증**: JWT (`jose`) + `bcryptjs`, 쿠키 세션
- **스타일**: CSS 디자인 토큰 (`globals.css`) — Tailwind는 settings 페이지에만 레거시로 존재
- **배포**: Vercel (`vercel --prod`)

## CSS 디자인 토큰

`globals.css`에 정의된 변수만 사용한다. 잘못된 이름을 쓰면 UI가 깨진다.

| 용도 | 올바른 변수 | ❌ 쓰면 안 되는 것 |
|------|------------|-----------------|
| 텍스트 기본 | `--ink` | `--fg`, `--foreground` |
| 텍스트 흐림 | `--ink-3`, `--ink-4` | `--fg-muted` |
| 강조색 | `--acc` | `--accent` |
| 강조 배경 | `--acc-bg` | — |
| 테두리 | `--line-hair`, `--line-soft` | `--border` |
| 카드 배경 | `--surface` | `--surface-raised` |
| 페이지 배경 | `--bg`, `--bg-2` | — |
| 오류 | `--bad`, `--bad-bg` | — |

## DB 타입 주의

PostgreSQL `NUMERIC`/`BIGINT` 컬럼은 JS에서 **문자열**로 반환된다.
클라이언트 컴포넌트에서 숫자 연산 전 반드시 `Number()` 로 파싱할 것.

```ts
// ✅
const cost = Number(row.cost_usd) || 0;
// ❌
const cost = row.cost_usd * 100; // "0.1234" * 100 = 10.234 (우연히 동작)
// ❌
const cost = row.cost_usd.toFixed(2); // TypeError
```

## 릴리즈 절차

새 기능 배포 시 아래 순서를 따른다. 단계를 건너뛰지 않는다.

### 1. 버전 번호 올리기

```bash
./scripts/release.sh patch   # 버그픽스
./scripts/release.sh minor   # 새 기능
./scripts/release.sh major   # 브레이킹 체인지
```

스크립트가 자동으로 처리하는 것:
- `package.json` `version` 필드 업
- `src/app/Topbar.tsx`의 `APP_VERSION` 상수 업
- `src/app/changelog/ChangelogViewer.tsx`의 `APP_VERSION` 상수 업

### 2. CHANGELOG.md 작성

`CHANGELOG.md` 상단에 새 섹션 추가:

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Added
- **기능명** — 한 줄 설명

### Fixed
- **수정 내용** — 한 줄 설명
```

### 3. 빌드 확인

```bash
npm run build
# ✓ Compiled successfully 확인
```

### 4. 프로덕션 배포

```bash
vercel --prod
# ▲ Aliased https://claude-monitor-nine.vercel.app 확인
```

### 5. DB 마이그레이션 (스키마 변경이 있는 경우만)

```bash
curl "https://claude-monitor-nine.vercel.app/api/migrate?token=<INGEST_TOKEN>"
# { "ok": true, "tables": [...] } 확인
```

### 6. 배포 검증

```bash
# 앱 응답 확인
curl -s -o /dev/null -w "%{http_code}" https://claude-monitor-nine.vercel.app
# → 200

# /changelog 페이지에 새 버전 표시 확인
curl -s https://claude-monitor-nine.vercel.app/changelog | grep -o "v[0-9]\+\.[0-9]\+\.[0-9]\+"
```

## 환경변수

로컬 `.env.local` 외에 Vercel 프로젝트에 동일한 값이 설정되어야 한다.
민감한 값(`INGEST_TOKEN`, `AUTH_SECRET`, `DATABASE_URL`)은 절대 코드에 하드코딩하지 않는다.
