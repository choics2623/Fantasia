// 콘텐츠 읽기 (node). 브라우저에서는 같은 JSON을 fetch해서 prepareContent에 넘긴다.
import { readFileSync } from "node:fs";
import { prepareContent } from "./game.mjs";
const root = new URL("../../", import.meta.url);
const J = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));
export function loadContent() {
  return prepareContent({ bundle: J("content/build/whereabouts.json"), cards: J("content/base/npcs/cards.json").cards, game: J("content/build/game.json") });
}
