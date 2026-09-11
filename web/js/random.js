// frank pro — 「適当に遊ぶ」ボタン
// 0本〜数百本の時期の最大の発見装置（docs/frank-pro-handoff.md 5章）

import { supabase } from "./supabaseClient.js";
import { openPlayer } from "./player.js";

export function initRandomButton() {
  const btn = document.getElementById("random-play-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const { data, error } = await supabase.rpc("get_random_work");
      if (error) throw error;
      const work = Array.isArray(data) ? data[0] : data;
      if (!work) {
        alert("まだ作品がありません。");
        return;
      }
      openPlayer(work.id);
    } catch (e) {
      console.error(e);
      alert("読み込みに失敗しました。");
    } finally {
      btn.disabled = false;
    }
  });
}
