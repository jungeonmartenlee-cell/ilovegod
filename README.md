# 하나님을 사랑합니다

청년 공동체들을 위한 홈페이지입니다. QR코드로 휴대폰에서 접속해서, 주일 설교 후 소그룹에서 함께 나누는 **GBS(Group Bible Study)** 자료와 공동체 소개를 봐요.
**한 사이트 안에 여러 공동체가 각자의 주소를 가지고** 들어갈 수 있어요.

사이트 주소: https://ilovegod-intl.web.app

## 주소 구조

| 주소 | 내용 |
|---|---|
| `/` | 메인 — 하나님을 사랑합니다 소개, 공동체 목록 |
| `/gil` | GIL 홈 — 이번 주 GBS, 소개 한 줄, 예배 시간·장소 |
| `/gil/about` | GIL 소개 — 비전, 섬기는 사람들, 모임 안내 |
| `/gil/gbs` | GIL GBS 목록 (최신순) |
| `/gil/gbs/2026-11-01` | 주차별 GBS 자료 |
| `/gil/gbs/latest` | **QR코드용 고정 주소** — 항상 그 공동체의 최신 GBS로 이동 |

## 파일 위치

| 무엇을 | 어디서 |
|---|---|
| 로고 글자, 메인 페이지 문구 | `src/config.ts` |
| 공동체 정보 (이름, 예배 시간, 소개, 섬기는 사람들, 설문지 버튼) | `src/communities/gil.ts` (공동체마다 파일 1개) |
| GBS 자료 | `src/content/gbs/gil/` (공동체마다 폴더 1개) |
| GBS 빈 양식 | `src/content/gbs/_템플릿.md` |

## 자주 하는 일

### ✍️ 매주 GBS 나눔지 올리기
나눔지는 **요약 · 나눔 · 5일 묵상 · 기도** 네 탭으로 보여요.
- 가장 쉬운 방법: 설교 원고를 Claude에게 주고 "나눔지로 만들어 줘"라고 요청하기
- 직접 만들 때: `src/content/gbs/_템플릿.md`를 복사해서 채우기
  - 한 공동체용 → `src/content/gbs/gil/2026-11-15.md`
  - 여러 공동체에 보내기 → `src/content/gbs/shared/2026-11-15.md` + `communities: [gil, shalom]`
- GitHub에 저장하면 1~2분 뒤 자동 반영돼요. 홈 카드, 목록, `/gil/gbs/latest`가 모두 알아서 바뀌어요.
- 5일 묵상만 주중에 보내고 싶으면 주소 끝에 `#devo`를 붙여 보내요. (나눔지 안의 "5일 묵상 링크 보내기" 버튼)

> 미리 써 두고 숨기려면 `draft: true`를 넣으세요.

### ✅ 교역자 검수·배포
- 나눔지 파일에 `status: review`를 적어 올리면 **사이트에 보이지 않아요.**
- 교역자가 **`/staff`** 에서 구글로 로그인 → 요약·나눔·묵상·기도를 한 화면씩 확인 → 보낼 공동체 선택 → **승인하고 배포하기** → 그 공동체에 바로 공개돼요.
- 교역자 등록: Firebase → Firestore → `staff` 컬렉션 → 문서 ID에 **구글 이메일**, 필드 `communities`(배열)에 맡은 공동체 (예: `gil`)
- 수정 요청 메모는 Firestore `feedback` 컬렉션에 쌓여요.

### 🏛️ 공동체 개설 신청
- 교역자가 `/staff` → **새 공동체 개설 신청**에서 이름·소속·주소 이름 등을 한 화면씩 입력해 신청해요. (Firestore `communityRequests`)
- 운영자(staff 문서에 `admin: true`)는 **개설 신청 확인하기**에서 "내용 복사" → Claude에게 붙여 넣으면 공동체가 열려요.

### 🌱 새 공동체 추가하기
1. `src/communities/gil.ts`를 복사해서 새 이름으로 저장해요. **파일 이름이 곧 주소예요.** (예: `shalom.ts` → `/shalom`, 영어 소문자 권장)
2. 새 파일 안의 `names`, 소개 문구, 예배 시간 등을 고쳐요. `order` 숫자로 메인 목록에서의 순서를 정해요.
3. `src/content/gbs/shalom/` 폴더를 만들고 GBS 자료를 넣어요.
4. GitHub에 저장하면 메인 목록에 새 공동체가 자동으로 나타나요.
5. QR코드는 `https://ilovegod-intl.web.app/shalom/gbs/latest`로 만들어요.

## 성경 본문 저작권 안내
개역개정 성경은 대한성서공회에 저작권이 있어요. 매주 몇 구절 정도 인용하는 것은 일반적으로 문제가 되지 않지만, 장 전체를 계속 싣는 것은 피하는 게 좋아요.

## 개발자용 명령어
```bash
npm install      # 처음 한 번
npm run dev      # 내 컴퓨터에서 미리보기 (http://localhost:4321)
npm run build    # 배포용 파일 만들기 (dist 폴더)
```
