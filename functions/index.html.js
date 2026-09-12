// index.js が担当するのは "/" 宛てのリクエストだけ。
// "/index.html?work=xxx" の形で直接共有された場合にも同じ処理を効かせるための別ルート。
import { handleOgp } from "./_lib/ogp.js";

export const onRequestGet = handleOgp;
