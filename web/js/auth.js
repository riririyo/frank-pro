// frank pro — ログイン（投稿には必要。閲覧・評価・コメントはログイン不要）
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

    const myPageLink = document.createElement("a");
    myPageLink.className = "btn";
    myPageLink.href = "mypage.html";
    myPageLink.textContent = "マイページ";

    const signOutBtn = document.createElement("button");
    signOutBtn.className = "btn";
    signOutBtn.textContent = "ログアウト";
    signOutBtn.addEventListener("click", async () => {
      await supabase.auth.signOut();
    });

    slot.appendChild(submitLink);
    slot.appendChild(myPageLink);
    slot.appendChild(signOutBtn);
  } else {
    slot.appendChild(buildLoginWidget());
  }
}

// window.prompt()だとブラウザのメアド自動入力候補が出せず入力しづらいので、
// 通常の<input type="email">を使ったその場展開フォームにしている
function buildLoginWidget() {
  const wrap = document.createElement("div");
  wrap.className = "login-widget";

  const loginBtn = document.createElement("button");
  loginBtn.type = "button";
  loginBtn.className = "btn btn-primary";
  loginBtn.textContent = "ログイン";

  const form = document.createElement("form");
  form.className = "login-form";
  form.hidden = true;
  form.innerHTML = `
    <input type="email" name="email" autocomplete="email" placeholder="メールアドレス" required />
    <button type="submit" class="btn btn-primary">送信</button>
  `;

  loginBtn.addEventListener("click", () => {
    form.hidden = false;
    loginBtn.hidden = true;
    form.querySelector("input").focus();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = form.querySelector("input[name=email]");
    const email = input.value.trim();
    if (!email) return;

    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + "/submit.html" },
    });
    submitBtn.disabled = false;

    if (error) {
      alert("送信に失敗しました: " + error.message);
      return;
    }
    alert(
      `${email} 宛にログインリンクを送りました。メールを確認してください。\n\n` +
        `※メールの送信者名は「frank html」ではなく「Supabase」と表示されますが、` +
        `frank htmlの認証の仕組み上そうなっているだけで、正規のメールです。`
    );
    form.reset();
    form.hidden = true;
    loginBtn.hidden = false;
  });

  wrap.appendChild(loginBtn);
  wrap.appendChild(form);
  return wrap;
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
