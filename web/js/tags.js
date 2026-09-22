// frank pro — タグの定義（唯一の情報源）
//
// ここに追加・削除すれば submit.js のUI・listing.js の絞り込みに反映される。
// サーバー側（supabase/functions/sign-upload/index.ts）はDenoでこのモジュールを
// importできないため、許可リストは同じ内容をあちらにも複製している。
// 追加・削除した場合は両方直すこと。

export const OPERATION_TAGS = [
  { value: "touch", label: "タッチ操作対応" },
  { value: "keyboard_required", label: "キーボード必須" },
  { value: "mouse_required", label: "マウス必須" },
  { value: "controller", label: "コントローラー推奨" },
  { value: "pc_only", label: "PC推奨（スマホ非対応）" },
];

export const CONTENT_TAGS = [
  { value: "sound", label: "音声あり" },
  { value: "rpg", label: "RPG" },
  { value: "puzzle", label: "パズル" },
  { value: "action", label: "アクション" },
  { value: "shooting", label: "シューティング" },
  { value: "rhythm", label: "音ゲー" },
  { value: "casual", label: "カジュアル" },
  { value: "simulation", label: "シミュレーション" },
  { value: "tool", label: "ツール・アプリ" },
  { value: "prototype", label: "試作・プロトタイプ" },
  { value: "joke", label: "ネタ・ジョーク" },
];

export const ALL_TAGS = [...OPERATION_TAGS, ...CONTENT_TAGS];
export const ALL_TAG_VALUES = ALL_TAGS.map((t) => t.value);
export const TAG_LABELS = Object.fromEntries(ALL_TAGS.map((t) => [t.value, t.label]));
