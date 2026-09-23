// frank pro — ジャンル定義（唯一の情報源）
//
// カテゴリ・操作環境タグ・内容タグの3層が重複して投稿者・閲覧者ともに迷っていたため、
// ジャンル1つ + スマホ対応(mobile_ok) + 音声有無(has_sound、自動判定)の形に整理した
// (旧 web/js/tags.js は廃止)。
// listing.js/author.js/history.jsはこのファイルからGENRE_LABELSをimportして使うこと
// (旧: 各ファイルで個別に同じ定義を重複させていた)。

export const GENRES = [
  { value: "action", label: "アクション" },
  { value: "puzzle", label: "パズル" },
  { value: "adventure", label: "RPG・冒険" },
  { value: "simulation", label: "シミュレーション" },
  { value: "casual", label: "まったり" },
  { value: "tool", label: "ツール" },
  { value: "other", label: "その他・実験" },
];
export const GENRE_VALUES = GENRES.map((g) => g.value);
export const GENRE_LABELS = Object.fromEntries(GENRES.map((g) => [g.value, g.label]));
