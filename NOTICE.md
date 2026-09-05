# 고지

## 비공식 도구입니다

이 프로그램은 Blizzard Entertainment 와 아무 관련이 없고, 후원이나 승인을 받지
않았습니다.

StarCraft II, 그 안의 유닛·건물·업그레이드 이름과 이미지, 상표는 모두
Blizzard Entertainment, Inc. 의 것입니다.

## 단계 그림 (아이콘)

**저장소에도, 설치 파일에도 들어 있지 않습니다.**

그림은 게임 파일에서 추출한 것이고 Blizzard Entertainment 의 저작물입니다.
담아서 배포하면 그 저작물을 복제해 배포하는 것이 되므로, 쓰겠다고 할 때 각자의
PC 가 공개된 원본에서 직접 받아갑니다.

- 앱: 제어창 → 오버레이 → **그림 내려받기**
- 개발: `node tools/fetch-icons.js`

받는 곳은 [sc2-planner](https://github.com/BurnySc2/sc2-planner) 입니다. 그
저장소의 코드는 MIT 지만 그림 자체의 권리는 Blizzard 에 있습니다.

저장소에 있는 `assets/icons/manifest.json` 은 한글 용어와 파일 이름을 잇는
표이고, 이 프로젝트가 만든 자료입니다.

## 글꼴

[Pretendard](https://github.com/orioncactus/pretendard) — SIL Open Font
License 1.1. 사본이 `src/renderer/fonts/OFL.txt` 에 있습니다.

## 게임 데이터를 읽는 방식

SC2 클라이언트가 스스로 여는 `localhost:6119` 의 `/game` 과 `/ui` 를
**읽기만** 합니다.

- 메모리를 읽지 않습니다
- 게임에 무엇도 주입하지 않습니다
- 게임에 아무것도 쓰지 않습니다

방송 오버레이가 쓰는 것과 같은, 블리자드가 공식적으로 열어둔 통로입니다.

## 코드

MIT 라이선스입니다 — [LICENSE](LICENSE). 이 라이선스는 이 프로젝트가 직접 쓴
코드에만 적용되며, 위의 게임 자산에는 적용되지 않습니다.
