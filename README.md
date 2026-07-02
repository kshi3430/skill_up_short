# 한입뚝딱 · 초간단 5분 레시피 스튜디오

학생, 자취생, 요리 초보자를 위한 유튜브 쇼츠 채널 운영용 풀스택 웹앱입니다. 레시피 아이디어를 정리하고, 주 5회 업로드 일정을 관리하며, 기획서의 `0~3초 / 3~8초 / 8~30초 / 30~40초` 구성에 맞는 촬영 대본을 만들 수 있습니다.

## 실행

Node.js 22 이상이 필요합니다. 외부 패키지 설치는 필요 없습니다.

```bash
cd /Users/kshi3430/short_pj/team_short_pj
npm start
```

브라우저에서 `http://127.0.0.1:3000`을 엽니다.

## 테스트

```bash
npm test
```

## 주요 기능

- 채널 통계와 콘텐츠 카테고리 현황 대시보드
- 레시피 등록, 검색, 수정, 삭제
- 업로드 일정 등록과 주간 캘린더
- 레시피명 하나만 입력하면 재료·조리 과정·촬영 장면까지 포함한 40초 쇼츠 대본 자동 생성
- 모바일, 태블릿, 데스크톱 반응형 화면
- JSON 파일 기반 로컬 데이터 저장 (`data/db.json`)
- API 입력 검증과 오류 처리

## AI API 키 설정

프로젝트에 준비된 `.env` 파일을 열고 사용할 키를 붙여 넣습니다.

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
IMAGE_API_URL=https://example-image-tunnel/generate
IMAGE_API_KEY=
IMAGE_MODEL=
TTS_API_URL=https://example-tts-tunnel/tts
TTS_API_KEY=
TTS_MODEL=
TTS_VOICE=default

GEMINI_API_KEY=your_gemini_api_key
STABILITY_API_KEY=your_stability_api_key
OPENAI_API_KEY=your_openai_api_key
```

로컬/팀원 모델을 사용할 때는 위의 Ollama, 이미지 터널, TTS 터널 값을 입력하고 서버를 다시 시작합니다. 터널 API는 Bearer 토큰을 지원하며, 이미지 응답은 이미지 바이너리·base64·data URL·파일 URL을, TTS 응답은 음성 바이너리·base64·data URL·파일 URL을 받을 수 있습니다. OpenAI 호환 API뿐 아니라 `prompt`/`image`, `text`/`audio` 형태의 단순 API도 지원합니다.

`GEMINI_API_KEY`가 있으면 비용 효율적인 stable 모델 `gemini-2.5-flash-lite`가 레시피와 대본을 생성합니다. `STABILITY_API_KEY`가 있으면 대본 화면의 `장면 이미지 4장 생성` 버튼으로 Stability AI Stable Image Core의 9:16 이미지를 만들 수 있습니다. 이미지 생성은 Stability 크레딧을 사용하므로 버튼을 눌렀을 때만 호출합니다.

텍스트 생성 우선순위는 `Gemini → OpenAI → 내장 템플릿`입니다. Gemini 키가 없고 OpenAI 키만 있으면 `gpt-5.4-nano`, 추론 `none`, 최대 출력 1,000토큰으로 동작합니다. 두 텍스트 API 키가 모두 비어 있으면 내장 레시피 방식으로 동작합니다.

API 키는 브라우저에 노출되지 않고 서버에서만 사용되며, `.gitignore`에 등록되어 Git에도 포함되지 않습니다. 연결 상태는 `http://127.0.0.1:3000/api/health`의 `textProvider`와 `imageEnabled` 값으로 확인할 수 있습니다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/health` | 서버 상태 |
| GET | `/api/dashboard` | 대시보드 통계 |
| GET/POST | `/api/recipes` | 레시피 목록/등록 |
| GET/PUT/DELETE | `/api/recipes/:id` | 레시피 상세/수정/삭제 |
| GET/POST | `/api/schedules` | 일정 목록/등록 |
| PATCH/DELETE | `/api/schedules/:id` | 일정 수정/삭제 |
| POST | `/api/generate-script` | 40초 쇼츠 대본 생성 |
| POST | `/api/generate-images` | Stability AI 장면 이미지 생성 |

## 프로젝트 구조

```text
team_short_pj/
├── data/db.json          # 최초 실행 시 자동 생성
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── test/api.test.mjs
├── db.mjs
├── gemini-shorts.mjs
├── openai-shorts.mjs
├── stability-images.mjs
├── server.mjs
└── package.json
```

운영 배포에서는 JSON 파일 대신 PostgreSQL/MySQL 같은 데이터베이스로 `JsonDatabase`를 교체하고, 관리자 로그인과 YouTube Data API 연동을 추가하는 것을 권장합니다.

## 개선방향
팀명 프로젝트명 프로젝트 소개 사용 기술스택 시스템 구조 실행 방법 및 API 목록 시연화면 또는 화면 캡처 미완성 기능 회고 및 개선 방향