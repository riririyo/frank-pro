// frank pro — ログイン（投稿にのみ必要。閲覧・評価・コメントはログイン不要）
// マジックリンク方式（パスワード不要）。ソーシャルログインを足す場合はここに追加する。

import { supabase } from "./supabaseClient.js";

export function initAuthHeader() {
  const slot = document.getElementById("auth-slot");
  if (!slot) return;

  refreshAuthUI(slot);
  supabase.auth.onAuthStateChange(() => refreshAuthUI(slot));
}

async function refreshAuthUI(slot) {
  const { data } = await supabase.auth.getUser();
  slot.innerHTML = "";

  if (data?.user) {
    const submitLink = document.createElement("a");
    submitLink.className = "btn btn-primary";
    submitLink.href = "submit.html";
    submitLink.textContent = "投稿する";

    const signOutBtn = document.createElement("button");
    signOutBtn.className = "btn";
    signOutBtn.textContent = "ログアウト";
    signOutBtn.addEventListener("click", async () => {
      await supabase.auth.signOut();
    });

    slot.appendChild(submitLink);
    slot.appendChild(signOutBtn);
  } else {
    const loginBtn = document.createElement("button");
    loginBtn.className = "btn btn-primary";
    loginBtn.textContent = "ログイン";
    loginBtn.addEventListener("click", promptLogin);
    slot.appendChild(loginBtn);
  }
}

async function promptLogin() {
  const email = prompt("ログイン用のメールアドレスを入力してください（ログインリンクを送ります）");
  if (!email) return;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + "/submit.html" },
  });
  if (error) {
    alert("送信に失敗しました: " + error.message);
    return;
  }
  alert(`${email} 宛にログインリンクを送りました。メールを確認してください。`);
}

export async function requireAuth() {
  const { data } = await supabase.auth.getUser();
  if (!data?.user) {
    alert("投稿にはログインが必要です。");
    location.href = "index.html";
    return null;
  }
  return data.user;
}
