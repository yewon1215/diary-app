# Diary (Local) — Day3

브라우저에 **로컬로 저장되는 일기 앱**입니다. 서버/DB 없이 동작하며 `localStorage`에 데이터를 저장합니다.

## 실행 방법

이 프로젝트는 `.env`에서 Supabase 키를 읽어 런타임에 주입하기 때문에, 아래 서버로 실행하는 것을 권장합니다.

```bash
cp .env.example .env
# .env 파일을 열어 SUPABASE_ANON_KEY를 채워주세요.

python3 server.py
```

그 다음 브라우저에서 아래 주소로 접속하세요.

- `http://localhost:5174`

> 파일을 더블클릭(`file://`)로 열어도 대부분 동작하지만, **가져오기/내보내기** 등 일부 브라우저 정책에 따라 제한이 있을 수 있어요. 위처럼 서버로 여는 것을 권장합니다.

## 주요 기능

- 일기 **작성 / 수정 / 삭제**
- **검색**(제목/내용/태그)
- **정렬**(최신/오래된/즐겨찾기)
- **태그**, **기분**, **날짜**
- **즐겨찾기(핀)**
- **임시저장(드래프트)**: 작성 중 자동 저장
- **내보내기/가져오기**: JSON 파일로 백업/복원
- **다크모드**
- **Supabase 저장/불러오기**: `entries` 테이블에 저장(스키마 `id/created_at/content`)

## 데이터 위치

브라우저 `localStorage`:

- `diary.entries.v1`
- `diary.settings.v1`
- `diary.draft.v1`
- `diary.weather.v1`

## Supabase 저장 방식

테이블 `entries`의 `content` 컬럼에 아래처럼 **일기 전체를 JSON 문자열로 직렬화해서 저장**합니다.

- 장점: DB 스키마가 단순해도(요청하신 `id/created_at/content`) 앱 기능(제목/태그/기분/즐겨찾기 등)을 그대로 유지할 수 있어요.

