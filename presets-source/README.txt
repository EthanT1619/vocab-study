presets-source — 엑셀 원본 폴더
================================

폴더 구조 예시 (presets/ 와 동일한 경로):

  presets-source/
  └── DSC/
      └── Lesson 5/
          ├── Lesson 5 - Vocab 1.xlsx
          └── Lesson 5 - Vocab 2.xlsx

엑셀 형식 (1행 헤더, A열 번호는 무시):
  B = 영어 단어
  C = 한국어 뜻
  D = 영어 뜻
  E = 영어 예문

변환 방법:
  1. xlsx 파일을 이 폴더에 저장
  2. tools\convert-presets.bat 더블클릭
  3. presets/ 아래에 JSON 생성 + manifest.json 자동 갱신
  4. GitHub push

파일명 규칙:
  *Vocab 1* → vocab1.json
  *Vocab 2* → vocab2.json
  그 외 → words.json
