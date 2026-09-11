// frank pro — コメント
//
// 方針（docs/security-design.md 3章）: ログイン不要・事前審査なし・全員同じ重み。
// スパムフィルタやレート制限は入れない。
// 唯一実装するのは「作者による非表示」と「通報3件での自動非表示」（法的リスク対応）。

import { CONFIG } from "./config.js";
import { supabase } from "./supabaseClient.js";
import { getVisitorId } from "./visitor.js";

// Supabase Edge Functionsはverify_jwt=falseでも、ゲートウェイを通すためにanon keyが要る
const FUNCTION_HEADERS = {
  "Content-Type": "application/json",
  apikey: CONFIG.SUPABASE_ANON_KEY,
  Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
};

const DELETE_TOKEN_PREFIX = "frankpro_comment_owner_";

export async function renderComments(container, workId) {
  if (!container) return;
  container.innerHTML = "<p class='form-hint'>読み込み中…</p>";

  const { data: comments, error } = await supabase
    .from("comments")
    .select("id, display_name, body, created_at")
    .eq("work_id", workId)
    .order("created_at", { ascending: false });

  if (error) {
    container.innerHTML = "<p class='form-hint error'>コメントを読み込めませんでした。</p>";
    console.error(error);
    return;
  }

  container.innerHTML = "";

  const form = buildForm(workId, () => renderComments(container, workId));
  container.appendChild(form);

  const list = document.createElement("div");
  list.className = "comment-list";
  if (comments.length === 0) {
    list.innerHTML = "<p class='form-hint'>まだコメントがありません。</p>";
  } else {
    for (const c of comments) {
      list.appendChild(buildCommentItem(c, workId));
    }
  }
  container.appendChild(list);
}

function buildForm(workId, onPosted) {
  const wrap = document.createElement("div");
  wrap.className = "comment-form";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "名前（省略可）";
  nameInput.maxLength = 40;

  const bodyInput = document.createElement("textarea");
  bodyInput.placeholder = "コメントを書く（500字まで）";
  bodyInput.maxLength = 500;

  const postBtn = document.createElement("button");
  postBtn.className = "btn btn-primary";
  postBtn.textContent = "投稿";
  postBtn.addEventListener("click", async () => {
    const body = bodyInput.value.trim();
    if (!body) return;
    postBtn.disabled = true;
    try {
      const visitorId = getVisitorId();
      const res = await fetch(CONFIG.SUBMIT_COMMENT_URL, {
        method: "POST",
        headers: FUNCTION_HEADERS,
        body: JSON.stringify({
          work_id: workId,
          visitor_id: visitorId,
          display_name: nameInput.value.trim() || "ななし",
          body,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "投稿に失敗しました");

      // 削除トークンとして自分のvisitor_idをこのコメントIDに紐付けて覚えておく
      try {
        localStorage.setItem(`${DELETE_TOKEN_PREFIX}${json.comment.id}`, visitorId);
      } catch {
        /* 保存できなくても致命的ではない */
      }

      bodyInput.value = "";
      nameInput.value = "";
      onPosted();
    } catch (e) {
      alert(e.message || "投稿に失敗しました");
    } finally {
      postBtn.disabled = false;
    }
  });

  wrap.appendChild(nameInput);
  wrap.appendChild(bodyInput);
  wrap.appendChild(postBtn);
  return wrap;
}

function buildCommentItem(comment, workId) {
  const item = document.createElement("div");
  item.className = "comment-item";

  const header = document.createElement("div");
  header.className = "comment-header";
  const name = document.createElement("span");
  name.className = "comment-name";
  name.textContent = comment.display_name;
  const time = document.createElement("span");
  time.textContent = formatRelativeTime(comment.created_at);
  header.appendChild(name);
  header.appendChild(time);

  const body = document.createElement("div");
  body.className = "comment-body";
  body.textContent = comment.body;

  const actions = document.createElement("div");
  actions.className = "comment-actions";

  const reportBtn = document.createElement("button");
  reportBtn.textContent = "通報";
  reportBtn.addEventListener("click", async () => {
    if (!confirm("このコメントを通報しますか？")) return;
    const { error } = await supabase.rpc("report_comment", {
      p_comment_id: comment.id,
      p_visitor_id: getVisitorId(),
    });
    if (!error) {
      reportBtn.textContent = "通報済み";
      reportBtn.disabled = true;
    }
  });
  actions.appendChild(reportBtn);

  // 自分が投稿したコメントなら削除ボタンを出す
  let myToken = null;
  try {
    myToken = localStorage.getItem(`${DELETE_TOKEN_PREFIX}${comment.id}`);
  } catch {
    /* noop */
  }
  if (myToken) {
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "削除";
    deleteBtn.addEventListener("click", async () => {
      if (!confirm("このコメントを削除しますか？")) return;
      const { error } = await supabase.rpc("delete_own_comment", {
        p_comment_id: comment.id,
        p_visitor_id: myToken,
      });
      if (!error) item.remove();
    });
    actions.appendChild(deleteBtn);
  }

  item.appendChild(header);
  item.appendChild(body);
  item.appendChild(actions);
  return item;
}

function formatRelativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "たった今";
  if (mins < 60) return `${mins}分前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  return `${days}日前`;
}
