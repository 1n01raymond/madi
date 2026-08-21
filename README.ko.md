# MADI

**웹을 위한 오픈 엔지니어링 스튜디오.**

MADI는 대형 CAD, BIM, engineering scene을 브라우저에서 열고 조합하고
분석하기 위한 오픈소스 WebGPU 워크스페이스이자 실행 런타임입니다.

MADI는 SolidWorks, CATIA, NX, Creo, Fusion, Onshape, Revit 같은 기존 상용
도구를 대체 포맷으로 바꾸라고 요구하지 않습니다. 기존 파일과 시스템을
source of truth로 유지하고, adapter와 compiler를 통해 브라우저용 scene을
자동 생성합니다.

초기 목표는 다음과 같습니다.

- STEP AP242 및 IFC 중심의 개방형 입력 경로
- 대형 assembly의 progressive streaming
- prototype/occurrence와 원본 object reference 보존
- 정확한 CAD edge, 선택, 숨김, 격리, 측정, 단면
- Worker decode와 제한된 CPU/GPU memory
- Three.js scene graph를 hot path에 사용하지 않는 직접 WebGPU runtime
- self-hosting과 제품 임베딩이 가능한 headless API
- TypeScript plugin 및 자동화 생태계

MADI 프로젝트 파일은 새로운 CAD 교환 포맷이 아닙니다. 원본 파일 참조,
배치, 카메라, 주석, selection set, plugin 상태를 저장하는 workspace이며,
렌더링 데이터는 언제든 재생성 가능한 cache입니다.

상세한 내용은 다음 문서에서 시작합니다.

- [제품 기획](docs/PRODUCT.md)
- [전체 아키텍처](docs/ARCHITECTURE.md)
- [Engineering Scene IR](docs/SCENE_IR.md)
- [컴파일러](docs/COMPILER.md)
- [WebGPU 런타임](docs/RUNTIME.md)
- [로드맵](docs/ROADMAP.md)

현재 상태는 `0.0.0-planning`이며 구현 전 공개 설계 단계입니다.
