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

// 遊んだ作品の履歴（history.htmlの「遊んだ履歴」機能で使う）。
// [{ id, playedAt }] を新しい順（先頭が最新）で保持する。
// 旧バージョンではID配列だけを保存していたので、そちらもフォールバックとして読む。
const PLAYED_KEY = "frankpro_played_ids"; // 旧形式（IDだけの配列）。互換のため書き込みも続ける
const HISTORY_KEY = "frankpro_play_history"; // 新形式（日時つき、新しい順）
const HISTORY_LIMIT = 200;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((e) => e && typeof e.id === "string");
      }
    }
  } catch {
    /* noop */
  }
  // 新形式のデータがなければ、旧形式（IDだけ）から日時なしで読み込む
  try {
    const raw = localStorage.getItem(PLAYED_KEY);
    const ids = raw ? JSON.parse(raw) : null;
    if (Array.isArray(ids)) {
      return ids.map((id) => ({ id, playedAt: null }));
    }
  } catch {
    /* noop */
  }
  return [];
}

// 「プレイ済み」バッジ表示用。一覧カードでの既プレイ判定にだけ使う
export function getPlayedIds() {
  return new Set(loadHistory().map((e) => e.id));
}

// 履歴ページ用。新しい順の配列 [{ id, playedAt }]
export function getPlayHistory() {
  return loadHistory();
}

export function markPlayed(workId) {
  try {
    const history = loadHistory().filter((e) => e.id !== workId);
    history.unshift({ id: workId, playedAt: new Date().toISOString() });
    const trimmed = history.slice(0, HISTORY_LIMIT);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    localStorage.setItem(PLAYED_KEY, JSON.stringify(trimmed.map((e) => e.id)));
  } catch {
    // 保存できなくても致命的ではないので無視する
  }
}

export function clearPlayHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(PLAYED_KEY);
  } catch {
    /* noop */
  }
}
