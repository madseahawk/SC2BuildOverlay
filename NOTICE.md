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

## 리플레이에서 빌드오더 뽑기

리플레이 파일을 읽는 일은 **블리자드가 직접 공개한 해독기**가 합니다.

- [s2protocol](https://github.com/Blizzard/s2protocol) — Copyright (c) 2013,
  2017 Blizzard Entertainment. MIT 라이선스.
- [mpyq](https://github.com/arkx/mpyq) — Copyright (c) 2010-2014 Aku
  Kotkavuo. BSD 라이선스. 리플레이를 담고 있는 MPQ 압축을 엽니다.

**둘 다 이 프로그램에 들어 있지 않습니다.** 파이썬도 들어 있지 않습니다. 리플레이
기능을 쓰겠다고 할 때 각자의 PC 가 [PyPI](https://pypi.org) 에서 받아, 앱 데이터
폴더 안의 전용 환경에만 설치합니다. 그 폴더를 지우면 흔적이 남지 않고, 시스템에
이미 있는 파이썬은 건드리지 않습니다.

파이썬은 각자 [python.org](https://www.python.org/downloads/) 에서 받아 설치합니다.
앱은 그 페이지를 브라우저로 열어주기만 하고, 설치 파일을 받거나 실행하지 않습니다.

읽는 대상은 **내 PC 에 있는 내 리플레이 파일**입니다. 게임이 실행 중이지 않아도
됩니다 — 게임 프로세스와 접점이 없습니다.

빌드 파일에 들어가는 유닛·건물·업그레이드의 한글 이름은 Blizzard Entertainment
의 공식 한국어 명칭이고, `src/main/translate.js` 의 표를 거쳐 옮깁니다.

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
