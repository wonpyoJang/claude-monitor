# Claude Monitor

Claude Code 사용량을 실시간으로 추적하는 멀티유저 모니터링 대시보드.

**라이브**: https://claude-monitor-nine.vercel.app

---

## 주요 기능

- **대시보드** — 일별 비용·토큰·턴 수, 7일 추이 차트
- **팀 랭킹전** — 초대 코드로 팀 구성, 6개 부문 시상 + 종합 점수
- **세션/디바이스 상세** — 세션별 메트릭, 멀티디바이스 지원
- **통계** — 언어별 비용 분포, 일별 상세 테이블
- **닉네임 & 아바타** — 팀 랭킹에 표시되는 프로필

---

## 로컬 개발

```bash
npm install
npm run dev        # http://localhost:3000
```

`.env.local` 필요:
```
DATABASE_URL=...
INGEST_TOKEN=...
AUTH_SECRET=...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## 클라이언트 설치 (Mac)

Claude Code Stop Hook을 자동으로 설정합니다:

```bash
# 토큰 포함 원라이너 (추천)
INGEST_TOKEN=<your_token> bash <(curl -fsSL https://claude-monitor-nine.vercel.app/install.sh)
```

설치 후 Claude Code 세션이 끝날 때마다 `~/.claude/scripts/log-turn.py` 가 실행되어 대시보드에 기록됩니다.

---

## 릴리즈 절차

### 1. 버전 번호 올리기

```bash
./scripts/release.sh patch   # 버그픽스 (0.2.0 → 0.2.1)
./scripts/release.sh minor   # 새 기능  (0.2.0 → 0.3.0)
./scripts/release.sh major   # 브레이킹  (0.2.0 → 1.0.0)
```

### 2. CHANGELOG.md 작성

`CHANGELOG.md` 상단에 새 섹션 추가:

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Added
- **기능명** — 설명

### Fixed
- **수정 내용** — 설명
```

### 3. 빌드 & 배포

```bash
npm run build        # 빌드 확인
vercel --prod        # 프로덕션 배포
```

### 4. DB 마이그레이션 (스키마 변경 시)

```bash
curl "https://claude-monitor-nine.vercel.app/api/migrate?token=<INGEST_TOKEN>"
# { "ok": true } 확인
```

### 5. 검증

- https://claude-monitor-nine.vercel.app/changelog 에서 새 버전 표시 확인
- Topbar "출시노트"에 초록 점 배지 표시 확인

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 프레임워크 | Next.js 16 App Router |
| 데이터베이스 | Neon PostgreSQL |
| 인증 | JWT (jose) + bcryptjs |
| 배포 | Vercel |
| 클라이언트 훅 | Python (`log-turn.py`) |

## 현재 버전

`v0.2.0` — [출시노트 보기](https://claude-monitor-nine.vercel.app/changelog)
