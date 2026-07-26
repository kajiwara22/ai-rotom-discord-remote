(function() {
  "use strict";

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => (el || document).querySelectorAll(sel);

  const userSelect = $("#user-select");
  const settingsBtn = $("#settings-btn");
  const newChatBtn = $("#new-chat-btn");
  const sessionList = $("#session-list");
  const messagesEl = $("#messages");
  const noChatEl = $("#no-chat");
  const loadingEl = $("#loading");
  const inputArea = $("#input-area");
  const messageInput = $("#message-input");
  const sendBtn = $("#send-btn");
  const promptDialog = $("#prompt-dialog");
  const promptTextarea = $("#prompt-textarea");
  const promptSaveBtn = $("#prompt-save");

  let currentUserId = null;
  let currentSessionId = null;
  let allSessions = [];
  let isSending = false;
  let isComposing = false;

  function getStoredUserId() {
    try { return localStorage.getItem("ai-rotom-user"); } catch (e) { return null; }
  }
  function setStoredUserId(id) {
    try { localStorage.setItem("ai-rotom-user", id); } catch (e) { /* ignore */ }
  }

  async function init() {
    currentUserId = getStoredUserId();

    await loadUsers();

    if (!currentUserId && userSelect.options.length > 0) {
      currentUserId = userSelect.options[0].value;
      setStoredUserId(currentUserId);
    }

    if (currentUserId) {
      ensureUser(currentUserId);
      userSelect.value = currentUserId;
      await loadSessions();
      setInputEnabled(true);
    } else {
      setInputEnabled(false);
    }

    userSelect.addEventListener("change", onUserChange);
    settingsBtn.addEventListener("click", openSettings);
    newChatBtn.addEventListener("click", startNewChat);
    promptSaveBtn.addEventListener("click", savePrompt);
    inputArea.addEventListener("submit", onSend);
    messageInput.addEventListener("keydown", onInputKeydown);
    messageInput.addEventListener("compositionstart", function() { isComposing = true; });
    messageInput.addEventListener("compositionend", function() { isComposing = false; });
  }

  async function ensureUser(userId) {
    try {
      await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, display_name: userId }),
      });
    } catch (e) { /* ignore */ }
  }

  async function loadUsers() {
    try {
      const res = await fetch("/api/users");
      const users = await res.json();
      userSelect.innerHTML = "";
      if (!Array.isArray(users) || users.length === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "（ユーザー名を入力）";
        userSelect.appendChild(opt);
        userSelect.value = "";
        const otherOpt = document.createElement("option");
        otherOpt.value = "__new__";
        otherOpt.textContent = "＋ 新規ユーザー作成...";
        userSelect.appendChild(otherOpt);
        return;
      }
      users.forEach(function(u) {
        const opt = document.createElement("option");
        opt.value = u.user_id;
        opt.textContent = u.display_name || u.user_id;
        userSelect.appendChild(opt);
      });
      const newOpt = document.createElement("option");
      newOpt.value = "__new__";
      newOpt.textContent = "＋ 新規ユーザー作成...";
      userSelect.appendChild(newOpt);
    } catch (e) {
      console.error("ユーザー一覧の取得に失敗:", e);
    }
  }

  async function onUserChange() {
    const val = userSelect.value;
    if (val === "__new__") {
      const name = prompt("新しいユーザー名を入力してください:");
      if (!name || !name.trim()) {
        userSelect.value = currentUserId || "";
        return;
      }
      const trimmed = name.trim();
      await ensureUser(trimmed);
      currentUserId = trimmed;
      setStoredUserId(trimmed);
      await loadUsers();
      userSelect.value = trimmed;
    } else if (val && val !== currentUserId) {
      currentUserId = val;
      setStoredUserId(val);
    } else {
      return;
    }
    setInputEnabled(true);
    selectSession(null);
    await loadSessions();
  }

  async function loadSessions() {
    if (!currentUserId) return;
    try {
      const res = await fetch("/api/sessions?user_id=" + encodeURIComponent(currentUserId));
      allSessions = await res.json();
      renderSessionList();
    } catch (e) {
      console.error("セッション一覧の取得に失敗:", e);
    }
  }

  function renderSessionList() {
    sessionList.innerHTML = "";
    if (!allSessions || allSessions.length === 0) {
      const div = document.createElement("div");
      div.className = "no-sessions";
      div.textContent = "セッションがありません";
      sessionList.appendChild(div);
      return;
    }
    allSessions.forEach(function(s) {
      const div = document.createElement("div");
      div.className = "session-item";
      div.dataset.sessionId = s.session_id;

      if (currentSessionId === s.session_id) {
        div.classList.add("active");
      }

      const nameEl = document.createElement("div");
      nameEl.className = "session-name";
      nameEl.textContent = s.session_name || "(無題)";

      const timeEl = document.createElement("div");
      timeEl.className = "session-time";
      timeEl.textContent = formatDate(s.updated_at);

      div.appendChild(nameEl);
      div.appendChild(timeEl);

      div.addEventListener("click", function() { selectSession(s.session_id); });

      div.addEventListener("dblclick", function(e) {
        e.preventDefault();
        const newName = prompt("セッション名を変更:", s.session_name || "");
        if (newName !== null) {
          renameSession(s.session_id, newName);
        }
      });

      sessionList.appendChild(div);
    });
  }

  function formatDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const pad = function(n) { return ("0" + n).slice(-2); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
      + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  async function renameSession(sessionId, newName) {
    try {
      await fetch("/api/sessions/" + sessionId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const ses = allSessions.find(function(s) { return s.session_id === sessionId; });
      if (ses) ses.session_name = newName;
      renderSessionList();
    } catch (e) {
      console.error("セッション名変更に失敗:", e);
    }
  }

  async function selectSession(sessionId) {
    currentSessionId = sessionId;
    messagesEl.innerHTML = "";
    noChatEl.style.display = "none";

    renderSessionList();

    if (!sessionId) {
      noChatEl.style.display = "flex";
      messagesEl.style.display = "none";
      return;
    }

    messagesEl.style.display = "block";
    await loadMessages(sessionId);
  }

  async function loadMessages(sessionId) {
    try {
      const res = await fetch("/api/sessions/" + sessionId);
      const msgs = await res.json();
      messagesEl.innerHTML = "";
      if (!Array.isArray(msgs)) return;

      msgs.forEach(function(m) {
        if (m.role === "system") return;
        if (m.role === "user") appendMessage("user", m.content);
        if (m.role === "assistant" && m.content) appendMessage("assistant", m.content);
      });

      messagesEl.scrollTop = messagesEl.scrollHeight;
    } catch (e) {
      console.error("メッセージ読み込みに失敗:", e);
    }
  }

  function appendMessage(role, content) {
    const div = document.createElement("div");
    div.className = "msg msg-" + role;

    const label = document.createElement("div");
    label.className = "msg-label";
    label.textContent = role === "user" ? "あなた" : "アシスタント";

    const body = document.createElement("div");
    body.className = "msg-body";

    if (role === "assistant") {
      body.innerHTML = marked.parse(content);
    } else {
      body.textContent = content;
    }

    div.appendChild(label);
    div.appendChild(body);
    messagesEl.appendChild(div);

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function startNewChat() {
    if (!currentUserId) return;
    selectSession(null);
    noChatEl.style.display = "none";
    messagesEl.style.display = "block";
    messagesEl.innerHTML = "";
    currentSessionId = null;
    setInputEnabled(true);
    messageInput.focus();
  }

  function setInputEnabled(enabled) {
    messageInput.disabled = !enabled;
    sendBtn.disabled = !enabled || isSending;
  }

  function onInputKeydown(e) {
    if (isComposing || e.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function onSend(e) {
    e.preventDefault();
    await sendMessage();
  }

  async function sendMessage() {
    if (!currentUserId || isSending) return;
    const msg = messageInput.value.trim();
    if (!msg) return;

    isSending = true;
    setInputEnabled(true);
    messageInput.value = "";

    noChatEl.style.display = "none";
    messagesEl.style.display = "block";

    appendMessage("user", msg);

    loadingEl.classList.add("active");
    messagesEl.scrollTop = messagesEl.scrollHeight;

    try {
      const body = { user_id: currentUserId, message: msg };
      if (currentSessionId) {
        body.session_id = currentSessionId;
      }

      const res = await fetch("/api/web/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "リクエストに失敗しました");
      }

      const data = await res.json();

      if (data.session_id) {
        currentSessionId = data.session_id;
      }

      appendMessage("assistant", data.reply || "回答がありませんでした。");

      await loadSessions();
      renderSessionList();

    } catch (e) {
      appendMessage("assistant", "エラー: " + (e.message || "不明なエラー"));
    } finally {
      loadingEl.classList.remove("active");
      isSending = false;
      setInputEnabled(true);
      messageInput.focus();
    }
  }

  async function openSettings() {
    if (!currentUserId) return;
    try {
      const res = await fetch("/api/users/" + encodeURIComponent(currentUserId) + "/prompt");
      const data = await res.json();
      promptTextarea.value = data.prompt_text || "";
      promptDialog.showModal();
    } catch (e) {
      console.error("プロンプト取得に失敗:", e);
    }
  }

  async function savePrompt() {
    if (!currentUserId) return;
    try {
      await fetch("/api/users/" + encodeURIComponent(currentUserId) + "/prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt_text: promptTextarea.value }),
      });
      promptDialog.close();
    } catch (e) {
      alert("保存に失敗しました: " + (e.message || ""));
    }
  }

  init().catch(function(e) { console.error("初期化エラー:", e); });
})();
