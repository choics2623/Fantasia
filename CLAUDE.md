# Fantasia — 작업 메모

## 링크판 (claude.ai Artifact)을 늘 최신으로
게임(엔진·콘텐츠·화면)을 바꾸는 커밋을 올렸으면 링크판도 새로 올린다 — 사용자는 서버 없이 이 링크로 한다.
1. `node tools/build_web.mjs` → `dist/web/` (판본 표시는 지금 커밋)
2. Artifact publish: `url` https://claude.ai/artifact/6PMT3WbY6rbhnK9WVAQeBF, `file_path` `dist/web/index.html`, `root` `dist/web`,
   `files` = `dist/web/files.json`의 목록(각각 `{"path": …}`). `capabilities`·`icon`은 넘기지 않는다 (처음 정한 것이 남는다).
   다른 대화에서 올릴 때는 먼저 `action: "read"`로 그 링크를 읽는다.
3. 서버판 `prototypes/greyford/server.mjs`에 `/api` 경로를 더하거나 바꾸면 `prototypes/greyford/web/boot.js`의 `handle`도 같이.
