// frank pro — 匿名訪問者の識別
//
// ログインなしで星評価・コメント・アクセス数のカウントを成立させるための最小限の識別子。
// これは不正対策ではない（消せば別人として振る舞える。それは許容する方針 — docs/frank-pro-handoff.md 2章）。
// 目的はUX: 誤操作の二重投票を防ぎ、付けた星を後から変えられるようにするため。

const KEY = "frankpro_visitor_id";

function generateId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getVisitorId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = generateId();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // localStorageが使えない環境（プライベートブラウズ等）ではセッション内だけの一時IDにする
    if (!window.__frankProSessionVisitorId) {
      window.__frankProSessionVisitorId = generateId();
    }
    return window.__frankProSessionVisitorId;
  }
}

// 既プレイの作品マーク（docs/frank-pro-handoff.md 5章）
const PLAYED_KEY = "frankpro_played_ids";

export function getPlayedIds() {
  try {
    const raw = localStorage.getItem(PLAYED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function markPlayed(workId) {
  try {
    const ids = getPlayedIds();
    ids.add(workId);
    localStorage.setItem(PLAYED_KEY, JSON.stringify([...ids]));
  } catch {
    // 保存できなくても致命的ではないので無視する
  }
}
