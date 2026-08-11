const API_BASE_URL =
  window.location.hostname === "localhost"
    ? "http://localhost:3000"
    : "https://buddy-chat-gz4m.onrender.com";

// Diagnostic: expose which API base the frontend selected (helps verify Vercel uses Render)
console.log('API_BASE_URL=', API_BASE_URL);

// Dynamically load the Socket.IO client if it's not already available.
function loadScript(src, timeout = 7000) {
  return new Promise((resolve, reject) => {
    // Avoid adding duplicate tags
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = (e) => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error(`Timeout loading ${src}`)), timeout);
  });
}

async function loadSocketClientIfNeeded() {
  if (typeof io !== "undefined") return true;

  // Try to load the client from the backend first (served by socket.io server)
  try {
    const backendClient = `${API_BASE_URL.replace(/\/$/, "")}/socket.io/socket.io.js`;
    await loadScript(backendClient, 6000);
    if (typeof io !== "undefined") return true;
  } catch (err) {
    console.warn("Backend socket.io client load failed:", err && err.message);
  }

  // Fallback to CDN
  try {
    const cdn = "https://cdn.socket.io/4.7.5/socket.io.min.js";
    await loadScript(cdn, 6000);
    if (typeof io !== "undefined") return true;
  } catch (err) {
    console.error("CDN socket.io client load failed:", err && err.message);
  }

  return false;
}

const authView = document.querySelector("#authView");
const chatView = document.querySelector("#chatView");
const loginPanel = document.querySelector("#loginPanel");
const registerPanel = document.querySelector("#registerPanel");
const showLoginTab = document.querySelector("#showLoginTab");
const showRegisterTab = document.querySelector("#showRegisterTab");
const loginForm = document.querySelector("#loginForm");
const loginEmailInput = document.querySelector("#loginEmailInput");
const loginPasswordInput = document.querySelector("#loginPasswordInput");
const loginMessage = document.querySelector("#loginMessage");
const loginError = document.querySelector("#loginError");
const registerEmailForm = document.querySelector("#registerEmailForm");
const registerEmailInput = document.querySelector("#registerEmailInput");
const otpForm = document.querySelector("#otpForm");
const otpInput = document.querySelector("#otpInput");
const resendOtpButton = document.querySelector("#resendOtpButton");
const passwordForm = document.querySelector("#passwordForm");
const passwordInput = document.querySelector("#passwordInput");
const confirmPasswordInput = document.querySelector("#confirmPasswordInput");
const pendingEmailText = document.querySelector("#pendingEmailText");
const registerMessage = document.querySelector("#registerMessage");
const registerError = document.querySelector("#registerError");
const emailStep = document.querySelector("#emailStep");
const otpStep = document.querySelector("#otpStep");
const passwordStep = document.querySelector("#passwordStep");
const currentUser = document.querySelector("#currentUser");
const currentEmail = document.querySelector("#currentEmail");
// left-corner logout removed; logout remains in profile menu
const recentChatsList = document.querySelector("#recentChatsList");
const searchResultsList = document.querySelector("#searchResultsList");
const chatTitle = document.querySelector("#chatTitle");
const chatStatus = document.querySelector("#chatStatus");
const emptyState = document.querySelector("#emptyState");
const messagesList = document.querySelector("#messagesList");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const chatError = document.querySelector("#chatError");
const profileButton = document.querySelector("#profileButton");
const profileMenu = document.querySelector("#profileMenu");
const menuDisplayName = document.querySelector("#menuDisplayName");
const menuEmail = document.querySelector("#menuEmail");
const changePasswordBtn = document.querySelector("#changePasswordBtn");
const menuLogoutBtn = document.querySelector("#menuLogoutBtn");
const viewProfileBtn = document.querySelector("#viewProfileBtn");
const headerAvatar = document.querySelector("#headerAvatar");
const sidebarEl = document.querySelector('.sidebar');
const logoMark = document.querySelector('.logo-mark');

// Change / Reset password modal elements
const changePasswordModal = document.querySelector("#changePasswordModal");
const cpEmailInput = document.querySelector("#cpEmailInput");
const cpSendOtpButton = document.querySelector("#cpSendOtpButton");
const cpStatus = document.querySelector("#cpStatus");
const cpError = document.querySelector("#cpError");
const cpOtpInput = document.querySelector("#cpOtpInput");
const cpVerifyOtpButton = document.querySelector("#cpVerifyOtpButton");
const cpResendOtpButton = document.querySelector("#cpResendOtpButton");
const cpNewPassword = document.querySelector("#cpNewPassword");
const cpConfirmNewPassword = document.querySelector("#cpConfirmNewPassword");
const cpUpdateButton = document.querySelector("#cpUpdateButton");
const cpCancelBtn = document.querySelector("#cpCancelBtn");
const closeChangePassword = document.querySelector("#closeChangePassword");
const loginForgotPasswordBtn = document.querySelector("#loginForgotPasswordBtn");

let cpVerificationToken = "";
let cpTargetEmail = "";

let token = localStorage.getItem("chatToken") || "";
let email = localStorage.getItem("chatEmail") || "";
let displayName = localStorage.getItem("chatDisplayName") || "";
let selectedUser = null;
let lastMessageId = 0;
let socket = null;
let usersTimer = null;
let pendingEmail = "";
let verificationToken = "";
let recentChatsCache = [];
let searchCache = [];
// Parse JWT payload without verifying signature to inspect expiry locally
function parseJwtPayload(t) {
  try {
    if (!t) return null;
    const part = t.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

async function fetchWithStatus(url, opts = {}) {
  try {
    const controller = new AbortController();
    const timeout = opts.timeout || 7000;
    const id = setTimeout(() => controller.abort(), timeout);
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const res = await fetch(url, { ...opts, headers, signal: controller.signal });
    clearTimeout(id);
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    // Network error or timeout
    return { ok: false, status: 0, error: err };
  }
}
const profileDetailsView = document.querySelector("#profileDetailsView");
const profileDetailsForm = document.querySelector("#profileDetailsForm");
const pdDisplayName = document.querySelector("#pdDisplayName");
const pdBio = document.querySelector("#pdBio");
const pdMessage = document.querySelector("#pdMessage");
const pdError = document.querySelector("#pdError");

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await response.json();

  console.log("API URL:", `${API_BASE_URL}${path}`);
  console.log("STATUS:", response.status);
  console.log("RESPONSE:", JSON.stringify(data, null, 2));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

function clearAuthMessages() {
  loginError.textContent = "";
  loginMessage.textContent = "";
  registerError.textContent = "";
  registerMessage.textContent = "";
}

function setAuthMode(mode) {
  clearAuthMessages();
  const isLogin = mode === "login";
  loginPanel.classList.toggle("hidden", !isLogin);
  registerPanel.classList.toggle("hidden", isLogin);
  showLoginTab.classList.toggle("active", isLogin);
  showRegisterTab.classList.toggle("active", !isLogin);
}

function setRegisterStep(step) {
  registerEmailForm.classList.toggle("hidden", step !== "email");
  otpForm.classList.toggle("hidden", step !== "otp");
  passwordForm.classList.toggle("hidden", step !== "password");
  emailStep.classList.toggle("active", step === "email");
  otpStep.classList.toggle("active", step === "otp");
  passwordStep.classList.toggle("active", step === "password");
}

// Forgot / Change Password Modal Logic
function openChangePasswordModal() {
  if (!changePasswordModal) return;
  cpVerificationToken = "";
  cpTargetEmail = email || (loginEmailInput ? loginEmailInput.value.trim() : "");
  if (cpEmailInput) cpEmailInput.value = cpTargetEmail;
  if (cpOtpInput) cpOtpInput.value = "";
  if (cpNewPassword) cpNewPassword.value = "";
  if (cpConfirmNewPassword) cpConfirmNewPassword.value = "";
  if (cpStatus) cpStatus.textContent = "";
  if (cpError) cpError.textContent = "";
  
  const step1 = document.getElementById("cpStepEmail");
  const step2 = document.getElementById("cpStepOtp");
  const step3 = document.getElementById("cpStepNewPassword");
  if (step1) step1.classList.remove("hidden");
  if (step2) step2.classList.add("hidden");
  if (step3) step3.classList.add("hidden");

  changePasswordModal.classList.remove("hidden");
  changePasswordModal.classList.add("active");
}

function closeChangePasswordModal() {
  if (changePasswordModal) {
    changePasswordModal.classList.add("hidden");
    changePasswordModal.classList.remove("active");
  }
}

if (changePasswordBtn) changePasswordBtn.addEventListener("click", () => openChangePasswordModal());
if (loginForgotPasswordBtn) loginForgotPasswordBtn.addEventListener("click", () => openChangePasswordModal());
if (closeChangePassword) closeChangePassword.addEventListener("click", () => closeChangePasswordModal());
if (cpCancelBtn) cpCancelBtn.addEventListener("click", () => closeChangePasswordModal());

if (cpSendOtpButton) {
  cpSendOtpButton.addEventListener("click", async () => {
    if (cpStatus) cpStatus.textContent = "Sending OTP...";
    if (cpError) cpError.textContent = "";
    cpTargetEmail = cpEmailInput ? cpEmailInput.value.trim() : "";
    if (!cpTargetEmail) {
      if (cpError) cpError.textContent = "Please enter your email address.";
      if (cpStatus) cpStatus.textContent = "";
      return;
    }
    try {
      await api("/api/password/send-otp", { method: "POST", body: JSON.stringify({ email: cpTargetEmail }) });
      if (cpStatus) cpStatus.textContent = `OTP code sent to ${cpTargetEmail}!`;
      const step1 = document.getElementById("cpStepEmail");
      const step2 = document.getElementById("cpStepOtp");
      if (step1) step1.classList.add("hidden");
      if (step2) step2.classList.remove("hidden");
    } catch (err) {
      if (cpError) cpError.textContent = err.message || "Failed to send OTP.";
      if (cpStatus) cpStatus.textContent = "";
    }
  });
}

if (cpVerifyOtpButton) {
  cpVerifyOtpButton.addEventListener("click", async () => {
    if (cpStatus) cpStatus.textContent = "Verifying code...";
    if (cpError) cpError.textContent = "";
    const otpVal = cpOtpInput ? cpOtpInput.value.trim() : "";
    if (!otpVal) {
      if (cpError) cpError.textContent = "Please enter the OTP code.";
      if (cpStatus) cpStatus.textContent = "";
      return;
    }
    try {
      const data = await api("/api/password/verify-otp", { method: "POST", body: JSON.stringify({ email: cpTargetEmail, otp: otpVal }) });
      cpVerificationToken = data.verificationToken;
      if (cpStatus) cpStatus.textContent = "Code verified! Enter your new password.";
      const step2 = document.getElementById("cpStepOtp");
      const step3 = document.getElementById("cpStepNewPassword");
      if (step2) step2.classList.add("hidden");
      if (step3) step3.classList.remove("hidden");
    } catch (err) {
      if (cpError) cpError.textContent = err.message || "Invalid OTP code.";
      if (cpStatus) cpStatus.textContent = "";
    }
  });
}

if (cpResendOtpButton) {
  cpResendOtpButton.addEventListener("click", async () => {
    if (cpStatus) cpStatus.textContent = "Resending OTP...";
    if (cpError) cpError.textContent = "";
    try {
      await api("/api/password/send-otp", { method: "POST", body: JSON.stringify({ email: cpTargetEmail }) });
      if (cpStatus) cpStatus.textContent = "New OTP code sent!";
    } catch (err) {
      if (cpError) cpError.textContent = err.message || "Failed to resend OTP.";
      if (cpStatus) cpStatus.textContent = "";
    }
  });
}

if (cpUpdateButton) {
  cpUpdateButton.addEventListener("click", async () => {
    if (cpStatus) cpStatus.textContent = "Updating password...";
    if (cpError) cpError.textContent = "";
    const newPass = cpNewPassword ? cpNewPassword.value : "";
    const confirmPass = cpConfirmNewPassword ? cpConfirmNewPassword.value : "";
    if (!newPass || newPass.length < 6) {
      if (cpError) cpError.textContent = "Password must be at least 6 characters.";
      if (cpStatus) cpStatus.textContent = "";
      return;
    }
    if (newPass !== confirmPass) {
      if (cpError) cpError.textContent = "Passwords do not match.";
      if (cpStatus) cpStatus.textContent = "";
      return;
    }
    try {
      await api("/api/password/update", {
        method: "POST",
        body: JSON.stringify({
          email: cpTargetEmail,
          verificationToken: cpVerificationToken,
          newPassword: newPass
        })
      });
      alert("Password updated successfully! Please log in with your new password.");
      closeChangePasswordModal();
      showAuth();
    } catch (err) {
      if (cpError) cpError.textContent = err.message || "Failed to update password.";
      if (cpStatus) cpStatus.textContent = "";
    }
  });
}

function storeSession(data) {
  token = data.token;
  email = data.email;
  displayName = data.displayName;
  const profilePicture = data.profilePicture || null;
  localStorage.setItem("chatToken", token);
  localStorage.setItem("chatEmail", email);
  localStorage.setItem("chatDisplayName", displayName);
  if (profilePicture) localStorage.setItem("chatProfilePicture", profilePicture);
  localStorage.removeItem("chatUsername");
}

function clearSession() {
  token = "";
  email = "";
  displayName = "";
  selectedUser = null;
  lastMessageId = 0;
  localStorage.removeItem("chatToken");
  localStorage.removeItem("chatEmail");
  localStorage.removeItem("chatDisplayName");
  localStorage.removeItem("chatProfilePicture");
  localStorage.removeItem("chatUsername");
}

function showChat() {
  authView.classList.add("hidden");
  chatView.classList.remove("hidden");
  currentUser.textContent = displayName;
  currentEmail.textContent = email;
  // populate header profile
  const profilePicture = localStorage.getItem("chatProfilePicture") || null;
  if (profilePicture) {
    headerAvatar.innerHTML = '';
    const img = document.createElement('img');
    img.src = profilePicture;
    img.alt = displayName;
    img.className = 'avatar-img avatar-mini';
    headerAvatar.appendChild(img);
  } else {
    headerAvatar.textContent = getInitials(displayName);
  }
  menuDisplayName.textContent = displayName;
  menuEmail.textContent = email;
  connectSocket();
  startUsersRefresh();
}

function applyTheme(theme) {
  const t = theme || localStorage.getItem('theme') || 'system';
  let effective = t;
  if (t === 'system') {
    effective = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  if (effective === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem('theme', t);
}

// Initial theme load
applyTheme();

function applyWallpaper(wallpaper) {
  const wp = wallpaper || localStorage.getItem('chatWallpaper') || 'default';
  const messagesList = document.getElementById('messagesList');
  if (messagesList) {
    messagesList.setAttribute('data-wallpaper', wp);
  }
  localStorage.setItem('chatWallpaper', wp);
}

// Initial wallpaper load
applyWallpaper();

const headerWallpaperBtn = document.getElementById('headerWallpaperBtn');
if (headerWallpaperBtn) {
  headerWallpaperBtn.addEventListener('click', () => {
    const wallpapers = ['default', 'emerald', 'dark-slate', 'soft-sand', 'cyber-night', 'sky-blue'];
    const current = localStorage.getItem('chatWallpaper') || 'default';
    const idx = wallpapers.indexOf(current);
    const next = wallpapers[(idx + 1) % wallpapers.length];
    applyWallpaper(next);
    const ppWallpaperSelect = document.getElementById('ppWallpaperSelect');
    if (ppWallpaperSelect) ppWallpaperSelect.value = next;
  });
}

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const savedTheme = localStorage.getItem('theme') || 'system';
    if (savedTheme === 'system') {
      applyTheme('system');
    }
  });
}

function showProfileDetails(prefill) {
  authView.classList.add("hidden");
  chatView.classList.add("hidden");
  profileDetailsView.classList.remove("hidden");
  pdMessage.textContent = "";
  pdError.textContent = "";
  pdDisplayName.value = prefill || displayName || "";
}

const welcomeLandingView = document.getElementById('welcomeLandingView');
const welcomeStartBtn = document.getElementById('welcomeStartBtn');

function showWelcomeLanding() {
  if (welcomeLandingView) {
    welcomeLandingView.classList.remove('hidden', 'fade-out');
  }
  if (authView) authView.classList.add('hidden');
  if (chatView) chatView.classList.add('hidden');
}

function hideWelcomeLanding() {
  if (welcomeLandingView) {
    welcomeLandingView.classList.add('fade-out');
    setTimeout(() => {
      welcomeLandingView.classList.add('hidden');
    }, 400);
  }
}

if (welcomeStartBtn) {
  welcomeStartBtn.addEventListener('click', () => {
    hideWelcomeLanding();
    setTimeout(() => {
      showAuth();
    }, 150);
  });
}

// Restore a saved session before showing the welcome screen. This prevents a
// signed-in user from being sent back through the landing animation on refresh.
async function restoreSession() {
  if (!token || !email) {
    showWelcomeLanding();
    return;
  }

  const payload = parseJwtPayload(token);
  if (payload && payload.exp && payload.exp * 1000 <= Date.now()) {
    clearSession();
    showWelcomeLanding();
    return;
  }

  // Render the saved session immediately, then confirm it with the server.
  if (welcomeLandingView) welcomeLandingView.classList.add('hidden');
  showChat();

  try {
    const account = await api('/api/me');
    email = account.email || email;
    displayName = account.displayName || displayName;
    localStorage.setItem('chatEmail', email);
    localStorage.setItem('chatDisplayName', displayName);
    if (account.profilePicture) localStorage.setItem('chatProfilePicture', account.profilePicture);

    if (!displayName.trim()) {
      hideProfileDetails();
      showProfileDetails('');
      return;
    }

    // Refresh the header with the verified account details.
    currentUser.textContent = displayName;
    currentEmail.textContent = email;
    menuDisplayName.textContent = displayName;
    menuEmail.textContent = email;
  } catch (error) {
    // A 401 means the token is no longer usable. Network/server failures do
    // not log the user out unnecessarily; the already-rendered chat stays on screen.
    if (error && /please log in|unauthorized|token/i.test(error.message || '')) {
      clearSession();
      if (chatView) chatView.classList.add('hidden');
      showWelcomeLanding();
    }
  }
}

restoreSession();

function hideProfileDetails() {
  profileDetailsView.classList.add("hidden");
}

function showAuth() {
  disconnectSocket();
  stopUsersRefresh();
  clearSession();
  if (welcomeLandingView) welcomeLandingView.classList.add('hidden');
  authView.classList.remove("hidden");
  chatView.classList.add("hidden");
  setAuthMode("login");
}

function startUsersRefresh() {
  stopUsersRefresh();
  loadRecentChats();
  usersTimer = setInterval(loadRecentChats, 15000);
}

function stopUsersRefresh() {
  clearInterval(usersTimer);
}

async function connectSocket() {
  try {
    disconnectSocket();

    const loaded = await loadSocketClientIfNeeded();
    if (!loaded || typeof io === "undefined") {
      console.error("Socket.IO client failed to load; socket disabled.");
      // Do not clear session or call showAuth(); allow the app to continue offline.
      return;
    }

    try {
      socket = io(API_BASE_URL, {
        auth: { token },
        transports: ["websocket", "polling"],
      });
    } catch (err) {
      console.error("Failed to create socket:", err && err.message);
      return;
    }

    socket.on("connect", () => {
      chatError.textContent = "";
      loadRecentChats();
    });

    socket.on("connect_error", (error) => {
      chatError.textContent = error && error.message ? error.message : "Socket connection failed.";
      console.warn('Socket connect_error', error);
      // Do not log the user out on socket errors.
    });

    socket.on("users:update", loadRecentChats);
    socket.on("private:message", handleSocketMessage);
    socket.on('typing:start', (payload) => {
      try {
        if (!payload || !payload.from) return;
        const el = document.getElementById('typingIndicator');
        if (selectedUser && payload.from === selectedUser.email && el) {
          el.textContent = payload.text || `${selectedUser.displayName} is typing...`;
        }
      } catch (e) {}
    });
    socket.on('typing:stop', (payload) => {
      try {
        if (!payload || !payload.from) return;
        const el = document.getElementById('typingIndicator');
        if (selectedUser && payload.from === selectedUser.email && el) {
          el.textContent = '';
        }
      } catch (e) {}
    });

    socket.on('message:delivered', (payload) => {
      try { updateMessageReceipt(payload.id, 'delivered'); } catch (e) {}
    });

    socket.on('message:seen', (payload) => {
      try { updateMessageReceipt(payload.id, 'seen'); } catch (e) {}
    });

    socket.on('message:reaction', (payload) => {
      try { updateMessageReactions(payload.id, payload.reactions); } catch (e) {}
    });

    socket.on('voice:uploaded', (payload) => {
      try { updateVoiceMessage(payload.id, payload.audioUrl, payload.audioDuration); } catch (e) {}
    });
  } catch (err) {
    console.error("connectSocket unexpected error:", err && err.message);
  }
}

function disconnectSocket() {
  if (!socket) return;
  socket.off("users:update", loadRecentChats);
  socket.off("private:message", handleSocketMessage);
  socket.disconnect();
  socket = null;
}

async function setChatTarget(user) {
  selectedUser = user;
  lastMessageId = 0;
  messagesList.innerHTML = "";
  emptyState.classList.add("hidden");
  messagesList.classList.remove("hidden");
  messageInput.disabled = false;
  sendButton.disabled = false;
  chatTitle.textContent = user.displayName;
  chatStatus.textContent = user.online ? "Online" : "Offline";
  chatError.textContent = "";

  try {
    // reset unread counter on the server for this conversation
    await api('/api/unread/reset', { method: 'POST', body: JSON.stringify({ withEmail: user.email }) });
  } catch (err) {
    console.warn('Failed to reset unread', err.message || err);
  }

  await loadMessages();
  // refresh recent chats to clear badge
  await loadRecentChats();
  renderActiveUser();
  messageInput.focus();
}

function renderActiveUser() {
  document.querySelectorAll(".user-button").forEach((button) => {
    button.classList.toggle("active", selectedUser && button.dataset.email === selectedUser.email);
  });
}

function getInitials(name) {
  return String(name || "U")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function renderRecentChats(list) {
  recentChatsCache = list || [];
  recentChatsList.innerHTML = '';
  if (!recentChatsCache.length) {
    const empty = document.createElement('div');
    empty.className = 'small-empty';
    empty.textContent = 'No recent chats yet.';
    recentChatsList.appendChild(empty);
    return;
  }

  recentChatsCache.forEach((user) => {
    const button = document.createElement('button');
    const avatar = document.createElement('span');
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    const mail = document.createElement('small');
    const presence = document.createElement('i');
    const last = document.createElement('small');
    const lastMsg = document.createElement('div');

    const display = (user.displayName && String(user.displayName).trim()) || user.email || 'User';

    button.type = 'button';
    button.className = 'user-button';
    button.dataset.email = user.email;
    avatar.className = 'avatar';
    if (user.profilePicture) {
      const img = document.createElement('img');
      img.src = user.profilePicture;
      img.alt = display;
      img.className = 'avatar-img';
      avatar.appendChild(img);
    } else {
      avatar.textContent = getInitials(display);
    }

    copy.className = 'user-copy';
    name.textContent = display;
    mail.textContent = user.email;
    presence.className = `presence ${user.online ? 'online' : 'offline'}`;
    presence.setAttribute('aria-label', user.online ? 'Online' : 'Offline');

    last.className = 'last-seen';
    if (user.lastMessageTime) {
      const d = new Date(user.lastMessageTime);
      last.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (user.lastSeen) {
      last.textContent = formatLastSeen(user.lastSeen);
    }

    lastMsg.className = 'last-message';
    if (user.lastMessageText) lastMsg.textContent = user.lastMessageText.slice(0, 80);

    copy.append(name, mail, last);

    const unread = document.createElement('span');
    unread.className = 'unread';
    if (user.unreadCount && Number(user.unreadCount) > 0) {
      unread.textContent = String(user.unreadCount);
      unread.style.display = '';
    } else {
      unread.style.display = 'none';
    }

    button.append(avatar, copy, presence, unread);
    button.addEventListener('click', () => setChatTarget(user));
    recentChatsList.appendChild(button);
  });

  if (selectedUser) {
    const updated = recentChatsCache.find((u) => u.email === selectedUser.email);
    if (updated) {
      selectedUser = updated;
      chatStatus.textContent = selectedUser.online ? 'Online' : 'Offline';
    }
  }

  renderActiveUser();
}

function renderSearchResults(list) {
  searchCache = list || [];
  searchResultsList.innerHTML = '';
  if (!searchCache.length) {
    const empty = document.createElement('div');
    empty.className = 'small-empty';
    empty.textContent = 'No matching users.';
    searchResultsList.appendChild(empty);
    return;
  }

  searchCache.forEach((user) => {
    const button = document.createElement('button');
    const avatar = document.createElement('span');
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    const mail = document.createElement('small');
    const presence = document.createElement('i');

    const display = (user.displayName && String(user.displayName).trim()) || user.email || 'User';

    button.type = 'button';
    button.className = 'user-button';
    button.dataset.email = user.email;
    avatar.className = 'avatar';
    if (user.profilePicture) {
      const img = document.createElement('img');
      img.src = user.profilePicture;
      img.alt = display;
      img.className = 'avatar-img';
      avatar.appendChild(img);
    } else {
      avatar.textContent = getInitials(display);
    }

    copy.className = 'user-copy';
    name.textContent = display;
    mail.textContent = user.email;
    presence.className = `presence ${user.online ? 'online' : 'offline'}`;
    presence.setAttribute('aria-label', user.online ? 'Online' : 'Offline');

    copy.append(name, mail);

    const unread = document.createElement('span');
    unread.className = 'unread';
    if (user.unreadCount && Number(user.unreadCount) > 0) {
      unread.textContent = String(user.unreadCount);
      unread.style.display = '';
    } else {
      unread.style.display = 'none';
    }

    button.append(avatar, copy, presence, unread);
    button.addEventListener('click', () => setChatTarget(user));
    searchResultsList.appendChild(button);
  });

  renderActiveUser();
}

function renderMessage(message) {
  const item = document.createElement('article');
  item.className = `message ${message.fromEmail === email ? 'mine' : ''}`;
  item.dataset.id = message.id;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (message.text) bubble.textContent = message.text;

  // Custom WhatsApp-Style Voice Message Player
  if (message.audioUrl) {
    const player = document.createElement('div');
    player.className = 'custom-voice-player';
    
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'voice-play-btn';
    playBtn.innerHTML = '▶';
    playBtn.title = 'Play voice message';
    
    const track = document.createElement('div');
    track.className = 'voice-track';
    
    const waveform = document.createElement('div');
    waveform.className = 'voice-waveform';
    for (let i = 0; i < 14; i++) {
      const bar = document.createElement('span');
      bar.className = 'wave-bar';
      waveform.appendChild(bar);
    }
    
    const progressContainer = document.createElement('div');
    progressContainer.className = 'voice-progress-container';
    const progressBar = document.createElement('div');
    progressBar.className = 'voice-progress-bar';
    progressContainer.appendChild(progressBar);
    
    track.append(waveform, progressContainer);
    
    const durationSpan = document.createElement('span');
    durationSpan.className = 'voice-duration';
    const initialDur = message.audioDuration ? Math.round(message.audioDuration / 1000) : 0;
    durationSpan.textContent = initialDur > 0 ? `${Math.floor(initialDur/60)}:${String(initialDur%60).padStart(2,'0')}` : '0:00';
    
    const hiddenAudio = document.createElement('audio');
    hiddenAudio.src = message.audioUrl && message.audioUrl.startsWith('http') ? message.audioUrl : `${API_BASE_URL.replace(/\/$/, '')}${message.audioUrl}`;
    hiddenAudio.preload = 'metadata';
    
    hiddenAudio.addEventListener('loadedmetadata', () => {
      if (hiddenAudio.duration && isFinite(hiddenAudio.duration)) {
        const dur = Math.round(hiddenAudio.duration);
        durationSpan.textContent = `${Math.floor(dur/60)}:${String(dur%60).padStart(2,'0')}`;
      }
    });
    
    hiddenAudio.addEventListener('timeupdate', () => {
      if (hiddenAudio.duration && isFinite(hiddenAudio.duration)) {
        const pct = (hiddenAudio.currentTime / hiddenAudio.duration) * 100;
        progressBar.style.width = `${pct}%`;
        const rem = Math.round(hiddenAudio.duration - hiddenAudio.currentTime);
        durationSpan.textContent = `${Math.floor(rem/60)}:${String(rem%60).padStart(2,'0')}`;
      }
    });
    
    hiddenAudio.addEventListener('play', () => {
      player.classList.add('playing');
      playBtn.innerHTML = '❚❚';
    });
    
    hiddenAudio.addEventListener('pause', () => {
      player.classList.remove('playing');
      playBtn.innerHTML = '▶';
    });
    
    hiddenAudio.addEventListener('ended', () => {
      player.classList.remove('playing');
      playBtn.innerHTML = '▶';
      progressBar.style.width = '0%';
      if (hiddenAudio.duration && isFinite(hiddenAudio.duration)) {
        const dur = Math.round(hiddenAudio.duration);
        durationSpan.textContent = `${Math.floor(dur/60)}:${String(dur%60).padStart(2,'0')}`;
      }
    });
    
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('audio').forEach(a => {
        if (a !== hiddenAudio) a.pause();
      });
      if (hiddenAudio.paused) {
        hiddenAudio.play().catch(console.error);
      } else {
        hiddenAudio.pause();
      }
    });
    
    progressContainer.addEventListener('click', (e) => {
      e.stopPropagation();
      if (hiddenAudio.duration && isFinite(hiddenAudio.duration)) {
        const rect = progressContainer.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        hiddenAudio.currentTime = pos * hiddenAudio.duration;
      }
    });
    
    player.append(playBtn, track, durationSpan, hiddenAudio);
    bubble.appendChild(player);
  }

  const meta = document.createElement('div');
  meta.className = 'meta';
  const ts = new Date(message.createdAt);
  const time = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const showDate = now - ts.getTime() > day;
  meta.textContent = `${message.fromName} • ${time}${showDate ? ' • ' + ts.toLocaleDateString() : ''}`;

  // receipt placeholder
  const receipt = document.createElement('span');
  receipt.className = 'receipt';
  receipt.style.marginLeft = '8px';
  if (message.status === 'delivered') receipt.textContent = '✓✓';
  else if (message.status === 'seen') receipt.textContent = '✓✓';
  else receipt.textContent = '✓';
  meta.appendChild(receipt);

  const bubbleRow = document.createElement('div');
  bubbleRow.className = 'bubble-row';

  // Reaction trigger button & floating picker
  const triggerBtn = document.createElement('button');
  triggerBtn.type = 'button';
  triggerBtn.className = 'react-trigger-btn';
  triggerBtn.innerHTML = '😊';
  triggerBtn.title = 'Add reaction';

  const picker = createReactionPicker(message.id);

  triggerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.reaction-picker').forEach(p => {
      if (p !== picker) p.classList.add('hidden');
    });
    if (messagesList) {
      const btnRect = triggerBtn.getBoundingClientRect();
      const listRect = messagesList.getBoundingClientRect();
      if (btnRect.top - listRect.top < 65) {
        picker.classList.add('position-bottom');
      } else {
        picker.classList.remove('position-bottom');
      }
    }
    picker.classList.toggle('hidden');
  });

  bubbleRow.append(bubble, triggerBtn, picker);

  // Initial reactions badges on bubble
  if (message.reactions) {
    updateMessageReactions(message.id, message.reactions);
  }

  item.append(bubbleRow, meta);
  messagesList.appendChild(item);
  // auto scroll to latest
  messagesList.scrollTop = messagesList.scrollHeight;
}

// Supported WhatsApp-style reactions
const SUPPORTED_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function createReactionPicker(messageId) {
  const picker = document.createElement('div');
  picker.className = 'reaction-picker hidden';
  
  SUPPORTED_REACTIONS.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reaction-emoji-btn';
    btn.textContent = emoji;
    btn.title = `React with ${emoji}`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      try {
        if (socket) socket.emit('message:reaction', { id: messageId, reaction: emoji });
      } catch (err) {}
      picker.classList.add('hidden');
    });
    picker.appendChild(btn);
  });
  
  return picker;
}

function updateMessageReceipt(id, status) {
  const el = messagesList.querySelector(`article[data-id="${id}"]`);
  if (!el) return;
  const receipt = el.querySelector('.receipt');
  if (!receipt) return;
  if (status === 'delivered') receipt.textContent = '✓✓';
  if (status === 'seen') receipt.textContent = '✓✓';
}

function updateMessageReactions(id, reactions) {
  const el = messagesList.querySelector(`article[data-id="${id}"]`);
  if (!el) return;
  const bubble = el.querySelector('.bubble');
  if (!bubble) return;

  let badgesContainer = bubble.querySelector('.reaction-badges');
  if (!badgesContainer) {
    badgesContainer = document.createElement('div');
    badgesContainer.className = 'reaction-badges';
    bubble.appendChild(badgesContainer);
  }
  
  badgesContainer.innerHTML = '';
  const current = reactions || {};
  let totalReactions = 0;

  SUPPORTED_REACTIONS.forEach((emoji) => {
    const users = current[emoji] || [];
    if (users.length > 0) {
      totalReactions += users.length;
      const pill = document.createElement('button');
      pill.type = 'button';
      const hasReacted = users.includes(email);
      pill.className = `reaction-badge-pill ${hasReacted ? 'user-reacted' : ''}`;
      pill.title = users.join(', ');
      
      const emojiSpan = document.createElement('span');
      emojiSpan.textContent = emoji;
      pill.appendChild(emojiSpan);
      
      if (users.length > 1) {
        const countSpan = document.createElement('span');
        countSpan.className = 'badge-count';
        countSpan.textContent = users.length;
        pill.appendChild(countSpan);
      }
      
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        try {
          if (socket) socket.emit('message:reaction', { id, reaction: emoji });
        } catch (err) {}
      });
      badgesContainer.appendChild(pill);
    }
  });

  if (totalReactions === 0) {
    badgesContainer.remove();
  }
}

function updateVoiceMessage(id, audioUrl, audioDuration) {
  const el = messagesList.querySelector(`article[data-id=\"${id}\"]`);
  if (!el) return;
  const audioEl = el.querySelector('audio');
  if (audioEl) audioEl.src = audioUrl && audioUrl.startsWith('http') ? audioUrl : `${API_BASE_URL.replace(/\/$/, '')}${audioUrl}`;
}

function isSelectedConversation(message) {
  return (
    selectedUser &&
    ((message.fromEmail === email && message.toEmail === selectedUser.email) ||
      (message.toEmail === email && message.fromEmail === selectedUser.email))
  );
}

function formatLastSeen(ts) {
  try {
    if (!ts) return '';
    const when = Number(ts) || 0;
    const diff = Date.now() - when;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Last seen just now';
    if (minutes < 60) return `Last seen ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    if (hours < 24) return `Last seen ${hours} hour${hours === 1 ? '' : 's'} ago`;
    if (days === 1) return 'Last seen yesterday';
    return `Last seen ${days} days ago`;
  } catch (e) { return ''; }
}

function handleSocketMessage(message) {
  // If message is for current user and not the active conversation, increment unread locally
  if (message.toEmail === email) {
    // acknowledge delivery
    try { socket && socket.emit('message:delivered', { id: message.id }); } catch (e) {}
    if (!selectedUser || selectedUser.email !== message.fromEmail) {
      incrementLocalUnread(message.fromEmail);
    }
  }

  if (!isSelectedConversation(message) || message.id <= lastMessageId) return;
  renderMessage(message);
  lastMessageId = Math.max(lastMessageId, message.id);
}

function incrementLocalUnread(fromEmail) {
  const btn = document.querySelector(`.user-button[data-email="${fromEmail}"]`);
  if (!btn) return;
  const badge = btn.querySelector('.unread');
  if (!badge) return;
  let val = Number(badge.textContent) || 0;
  val = val + 1;
  badge.textContent = String(val);
  badge.style.display = '';
}

async function loadRecentChats() {
  try {
    const data = await api('/api/recent-chats');
    renderRecentChats(data.recentChats || []);
    // show recent chats and hide search results
    if (recentChatsList) recentChatsList.style.display = '';
    if (searchResultsList) searchResultsList.style.display = 'none';
  } catch (error) {
    chatError.textContent = error.message;
    if (error.message.includes('log in')) showAuth();
  }
}

async function searchUsers(q) {
  try {
    if (!q || !q.trim()) return;
    const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    renderSearchResults(data.users || []);
    if (recentChatsList) recentChatsList.style.display = 'none';
    if (searchResultsList) searchResultsList.style.display = '';
  } catch (error) {
    chatError.textContent = error.message;
    if (error.message.includes('log in')) showAuth();
  }
}

async function loadMessages() {
  if (!selectedUser) return;

  try {
    const data = await api(
      `/api/messages?with=${encodeURIComponent(selectedUser.email)}&after=${lastMessageId}`
    );
    const toMarkSeen = [];
    data.messages.forEach((message) => {
      renderMessage(message);
      lastMessageId = Math.max(lastMessageId, message.id);
      // if this client is recipient and message not seen yet, mark for seen
      if (message.toEmail === email && message.status !== 'seen') {
        toMarkSeen.push(message.id);
      }
    });

    if (toMarkSeen.length && socket && socket.connected) {
      try { socket.emit('message:seen', { ids: toMarkSeen }); } catch (e) {}
    }
  } catch (error) {
    chatError.textContent = error.message;
  }
}

async function requestOtp(emailAddress) {
  console.log('[FRONTEND] OTP request for', emailAddress);
  const data = await api("/api/register/request-otp", {
    method: "POST",
    body: JSON.stringify({ email: emailAddress }),
  });

  pendingEmail = data.email;
  pendingEmailText.textContent = pendingEmail;
  setRegisterStep("otp");
  registerMessage.textContent = "Verification code sent to your email.";
  otpInput.value = "";
  otpInput.focus();
}

showLoginTab.addEventListener("click", () => setAuthMode("login"));
showRegisterTab.addEventListener("click", () => {
  setAuthMode("register");
  setRegisterStep("email");
});

registerEmailForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAuthMessages();

  try {
    await requestOtp(registerEmailInput.value);
  } catch (error) {
    registerError.textContent = error.message;
  }
});

resendOtpButton.addEventListener("click", async () => {
  clearAuthMessages();

  try {
    await requestOtp(pendingEmail);
  } catch (error) {
    registerError.textContent = error.message;
  }
});

otpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAuthMessages();
  console.log('[FRONTEND] verify OTP for', pendingEmail, otpInput.value);

  try {
    const data = await api("/api/register/verify-otp", {
      method: "POST",
      body: JSON.stringify({ email: pendingEmail, otp: otpInput.value }),
    });
    console.log('[FRONTEND] verify-otp response', data);
    verificationToken = data.verificationToken;
    setRegisterStep("password");
    registerMessage.textContent = "Email verified. Create your password.";
    passwordInput.focus();
  } catch (error) {
    registerError.textContent = error.message;
  }
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAuthMessages();

  if (passwordInput.value !== confirmPasswordInput.value) {
    registerError.textContent = "Passwords do not match.";
    return;
  }

  try {
    console.log('[FRONTEND] completing registration with token', verificationToken);
    await api("/api/register/complete", {
      method: "POST",
      body: JSON.stringify({
        verificationToken,
        password: passwordInput.value,
      }),
    });
    console.log('[FRONTEND] registration complete for', pendingEmail);

    loginEmailInput.value = pendingEmail;
    loginPasswordInput.value = "";
    passwordInput.value = "";
    confirmPasswordInput.value = "";
    setAuthMode("login");
    loginMessage.textContent = "Account created successfully. Please log in.";
  } catch (error) {
    registerError.textContent = error.message;
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAuthMessages();

  console.log('[FRONTEND] login attempt for', loginEmailInput.value);
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        email: loginEmailInput.value,
        password: loginPasswordInput.value,
      }),
    });
    console.log('[FRONTEND] login success', data.email);
    storeSession(data);
    loginPasswordInput.value = "";
    // After login, prompt for profile details before entering chat
    showProfileDetails(data.displayName || "");
  } catch (error) {
    console.error('[FRONTEND] login failed', error.message);
    loginError.textContent = error.message;
  }
});

// Profile menu toggle
profileButton.addEventListener("click", (e) => {
  e.stopPropagation();
  const isOpen = !profileMenu.classList.contains("hidden");
  profileMenu.classList.toggle("hidden", isOpen);
  profileButton.setAttribute("aria-expanded", String(!isOpen));
});

// close menu on outside click
document.addEventListener("click", () => profileMenu.classList.add("hidden"));
profileMenu.addEventListener("click", (e) => e.stopPropagation());

if (menuLogoutBtn) {
  menuLogoutBtn.addEventListener("click", async () => {
    try {
      await api("/api/logout", { method: "POST" });
    } finally {
      showAuth();
    }
  });
}

changePasswordBtn.addEventListener("click", () => {
  openChangePasswordModal();
  profileMenu.classList.add("hidden");
});

function openChangePasswordModal(prefillEmail) {
  cpVerificationToken = "";
  cpTargetEmail = (prefillEmail && String(prefillEmail).trim()) || email || (loginEmailInput ? loginEmailInput.value.trim() : "") || "";
  if (cpEmailInput) cpEmailInput.value = cpTargetEmail;
  if (cpOtpInput) cpOtpInput.value = "";
  if (cpNewPassword) cpNewPassword.value = "";
  if (cpConfirmNewPassword) cpConfirmNewPassword.value = "";
  if (cpStatus) cpStatus.textContent = "";
  if (cpError) cpError.textContent = "";
  document.querySelectorAll("#cpStepCurrent, #cpStepOtp, #cpStepNew").forEach((el) => el.classList.add("hidden"));
  document.querySelector("#cpStepCurrent").classList.remove("hidden");
  if (changePasswordModal) changePasswordModal.classList.remove("hidden");
  if (cpEmailInput && !cpEmailInput.value) cpEmailInput.focus();
}

function closeChangePasswordModal() {
  if (changePasswordModal) changePasswordModal.classList.add("hidden");
}

if (cpCancelBtn) cpCancelBtn.addEventListener("click", closeChangePasswordModal);
if (closeChangePassword) closeChangePassword.addEventListener("click", closeChangePasswordModal);

if (loginForgotPasswordBtn) {
  loginForgotPasswordBtn.addEventListener("click", () => {
    const prefill = loginEmailInput ? loginEmailInput.value.trim() : "";
    openChangePasswordModal(prefill);
  });
}

// Send OTP
if (cpSendOtpButton) {
  cpSendOtpButton.addEventListener("click", async () => {
    cpError.textContent = "";
    const targetEmail = (cpEmailInput ? cpEmailInput.value.trim().toLowerCase() : cpTargetEmail) || email;
    if (!targetEmail) {
      cpError.textContent = "Please enter your email address.";
      return;
    }
    cpTargetEmail = targetEmail;
    cpStatus.textContent = "Sending verification code...";
    cpSendOtpButton.disabled = true;
    try {
      await api("/api/password/send-otp", {
        method: "POST",
        body: JSON.stringify({ email: targetEmail }),
      });
      cpStatus.textContent = `Verification code sent to ${targetEmail}.`;
      document.querySelectorAll("#cpStepCurrent, #cpStepOtp, #cpStepNew").forEach((el) => el.classList.add("hidden"));
      document.querySelector("#cpStepOtp").classList.remove("hidden");
      if (cpOtpInput) cpOtpInput.focus();
    } catch (err) {
      cpError.textContent = err.message;
      cpStatus.textContent = "";
    } finally {
      cpSendOtpButton.disabled = false;
    }
  });
}

if (cpResendOtpButton) {
  cpResendOtpButton.addEventListener("click", async () => {
    cpError.textContent = "";
    const targetEmail = cpTargetEmail || (cpEmailInput ? cpEmailInput.value.trim().toLowerCase() : email);
    if (!targetEmail) return;
    cpStatus.textContent = "Resending code...";
    cpResendOtpButton.disabled = true;
    try {
      await api("/api/password/send-otp", {
        method: "POST",
        body: JSON.stringify({ email: targetEmail }),
      });
      cpStatus.textContent = "Verification code resent.";
      if (cpOtpInput) cpOtpInput.focus();
    } catch (err) {
      cpError.textContent = err.message;
      cpStatus.textContent = "";
    } finally {
      cpResendOtpButton.disabled = false;
    }
  });
}

// Verify OTP
if (cpVerifyOtpButton) {
  cpVerifyOtpButton.addEventListener("click", async () => {
    cpError.textContent = "";
    const targetEmail = cpTargetEmail || (cpEmailInput ? cpEmailInput.value.trim().toLowerCase() : email);
    const otpVal = cpOtpInput ? cpOtpInput.value.trim() : "";
    if (!targetEmail || !otpVal) {
      cpError.textContent = "Please enter the 6-digit verification code.";
      return;
    }
    cpStatus.textContent = "Verifying code...";
    cpVerifyOtpButton.disabled = true;
    try {
      const data = await api("/api/password/verify-otp", {
        method: "POST",
        body: JSON.stringify({ email: targetEmail, otp: otpVal }),
      });
      cpVerificationToken = data.verificationToken;
      cpStatus.textContent = "Code verified. Enter a new password.";
      document.querySelectorAll("#cpStepCurrent, #cpStepOtp, #cpStepNew").forEach((el) => el.classList.add("hidden"));
      document.querySelector("#cpStepNew").classList.remove("hidden");
      if (cpNewPassword) cpNewPassword.focus();
    } catch (err) {
      cpError.textContent = err.message;
      cpStatus.textContent = "";
    } finally {
      cpVerifyOtpButton.disabled = false;
    }
  });
}

// Update password
if (cpUpdateButton) {
  cpUpdateButton.addEventListener("click", async () => {
    cpError.textContent = "";
    if (!cpNewPassword || !cpConfirmNewPassword) return;
    if (cpNewPassword.value !== cpConfirmNewPassword.value) {
      cpError.textContent = "Passwords do not match.";
      return;
    }
    cpStatus.textContent = "Updating password...";
    cpUpdateButton.disabled = true;
    try {
      await api("/api/password/update", {
        method: "POST",
        body: JSON.stringify({ verificationToken: cpVerificationToken, password: cpNewPassword.value }),
      });
      cpStatus.textContent = "Password updated successfully. You can now log in.";
      setTimeout(() => closeChangePasswordModal(), 1200);
    } catch (err) {
      cpError.textContent = err.message;
      cpStatus.textContent = "";
    } finally {
      cpUpdateButton.disabled = false;
    }
  });
}

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  chatError.textContent = "";

  if (!socket || !socket.connected) {
    chatError.textContent = "Chat socket is not connected yet.";
    return;
  }

  const text = messageInput.value.trim();
  messageInput.value = "";

  socket.emit("private:message", { to: selectedUser.email, text }, (response) => {
    if (response && response.ok) return;
    chatError.textContent = (response && response.error) || "Message failed.";
    messageInput.value = text;
  });
});

// typing indicator: send throttled start/stop events when input changes
let _typingThrottle = 0;
let _typingTimer = null;
messageInput.addEventListener('input', () => {
  if (!socket || !socket.connected || !selectedUser) return;
  try {
    const now = Date.now();
    if (!_typingThrottle || now - _typingThrottle > 800) {
      socket.emit('typing:start', { to: selectedUser.email });
      _typingThrottle = now;
    }
    if (_typingTimer) clearTimeout(_typingTimer);
    _typingTimer = setTimeout(() => {
      try { socket.emit('typing:stop', { to: selectedUser.email }); } catch (e) {}
      _typingThrottle = 0;
    }, 2000);
  } catch (e) {}
});

// Search input handler
const usersSearchInput = document.getElementById('usersSearchInput');
if (usersSearchInput) {
  let searchTimer = null;
  usersSearchInput.addEventListener('input', () => {
    const q = usersSearchInput.value || '';
    if (!q.trim()) {
      // clear search results and show recent chats
      if (searchResultsList) searchResultsList.innerHTML = '';
      if (searchResultsList) searchResultsList.style.display = 'none';
      if (recentChatsList) recentChatsList.style.display = '';
      return;
    }
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchUsers(q.trim());
    }, 250);
  });
}

// Voice message recording
const recordBtn = document.getElementById('recordBtn');
let mediaRecorder = null;
let mediaStream = null;
let recordingStart = 0;
let recordingTimer = null;
async function startRecording() {
  if (!selectedUser) { alert('Select a conversation first'); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { alert('Recording not supported in this browser'); return; }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(mediaStream);
    const chunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' });
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = arrayBufferToBase64(arrayBuffer);
      const duration = Date.now() - recordingStart;
      try {
        recordBtn.disabled = true;
        const data = await api('/api/voice/upload', { method: 'POST', body: JSON.stringify({ to: selectedUser.email, audioBase64: base64, audioType: blob.type, duration }) });
        // server will emit the created message via socket
      } catch (err) {
        alert('Upload failed: ' + (err && err.message));
      } finally {
        recordBtn.disabled = false;
      }
      // cleanup
      if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
      mediaRecorder = null;
      recordingStart = 0;
      if (recordingTimer) clearTimeout(recordingTimer);
      recordBtn.textContent = '🎤';
    };
    mediaRecorder.start();
    recordingStart = Date.now();
    recordBtn.textContent = '⏺';
    // auto-stop after 2 minutes
    recordingTimer = setTimeout(() => {
      try { if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop(); } catch (e) {}
    }, 120000);
  } catch (err) {
    alert('Could not start recording: ' + (err && err.message));
  }
}

function stopRecording() {
  try {
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
  } catch (e) {}
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

if (recordBtn) {
  let recording = false;
  recordBtn.addEventListener('click', async () => {
    if (!recording) {
      recording = true;
      await startRecording();
      // flip state when recorder stops
      const watch = setInterval(() => { if (!mediaRecorder) { recording = false; clearInterval(watch); } }, 300);
    } else {
      stopRecording();
    }
  });
}

// Profile Page and actions
const profilePage = document.getElementById('profilePage');
const ppAvatarImg = document.getElementById('ppAvatarImg');
const ppFileInput = document.getElementById('ppFileInput');
const ppChooseBtn = document.getElementById('ppChooseBtn');
const ppSavePhoto = document.getElementById('ppSavePhoto');
const ppCancelPhoto = document.getElementById('ppCancelPhoto');
const ppDisplayNameEl = document.getElementById('ppDisplayName');
const ppEmailEl = document.getElementById('ppEmail');
const ppStatusEl = document.getElementById('ppStatus');
const ppBioEl = document.getElementById('ppBio');
const ppTotalChats = document.getElementById('ppTotalChats');
const ppTotalMessages = document.getElementById('ppTotalMessages');
const ppSharedMediaCount = document.getElementById('ppSharedMediaCount');
const ppJoinedEl = document.getElementById('ppJoined');
const ppLastSeenEl = document.getElementById('ppLastSeen');
const ppSettingsForm = document.getElementById('ppSettingsForm');
const ppEditDisplayName = document.getElementById('ppEditDisplayName');
const ppEditBio = document.getElementById('ppEditBio');
const ppThemeSelect = document.getElementById('ppThemeSelect');
const ppNotifEmail = document.getElementById('ppNotifEmail');
const ppNotifPush = document.getElementById('ppNotifPush');
const ppNotifSound = document.getElementById('ppNotifSound');
const ppChangePassword = document.getElementById('ppChangePassword');
const ppLogout = document.getElementById('ppLogout');
const ppClose = document.getElementById('ppClose');
let _ppSelectedImage = null;

function closeProfilePage() {
  if (profilePage) {
    profilePage.classList.remove('active');
    profilePage.classList.add('hidden');
  }
  showChat();
}

async function openProfilePage() {
  try {
    profileMenu.classList.add('hidden');
    const me = await api('/api/me');
    let stats = { totalChats: 0, totalMessages: 0, sharedMediaCount: 0 };
    try { stats = await api('/api/me/stats'); } catch (e) {}

    const ppAvatarInitials = document.getElementById('ppAvatarInitials');
    if (me.profilePicture) {
      if (ppAvatarImg) {
        ppAvatarImg.src = me.profilePicture;
        ppAvatarImg.classList.remove('hidden');
      }
      if (ppAvatarInitials) ppAvatarInitials.classList.add('hidden');
    } else {
      if (ppAvatarImg) ppAvatarImg.classList.add('hidden');
      if (ppAvatarInitials) {
        ppAvatarInitials.textContent = getInitials(me.displayName || me.email);
        ppAvatarInitials.classList.remove('hidden');
      }
    }

    if (ppDisplayNameEl) ppDisplayNameEl.textContent = me.displayName || '';
    if (ppEmailEl) ppEmailEl.textContent = me.email || '';
    if (ppBioEl) ppBioEl.textContent = me.bio || '';
    if (ppStatusEl) ppStatusEl.textContent = (me.lastSeen && Date.now() - new Date(me.lastSeen).getTime() < 60_000) ? 'Online' : 'Offline';
    if (ppJoinedEl) ppJoinedEl.textContent = me.joinedAt ? new Date(me.joinedAt).toLocaleDateString() : '';
    if (ppLastSeenEl) ppLastSeenEl.textContent = me.lastSeen ? new Date(me.lastSeen).toLocaleString() : '';
    if (ppTotalChats) ppTotalChats.textContent = stats.totalChats || 0;
    if (ppTotalMessages) ppTotalMessages.textContent = stats.totalMessages || 0;
    if (ppSharedMediaCount) ppSharedMediaCount.textContent = stats.sharedMediaCount || 0;

    // prefill settings
    if (ppEditDisplayName) ppEditDisplayName.value = me.displayName || '';
    if (ppEditBio) ppEditBio.value = me.bio || '';
    if (ppThemeSelect) {
      ppThemeSelect.value = me.theme || localStorage.getItem('theme') || 'system';
      applyTheme(ppThemeSelect.value);
    }
    const ppWallpaperSelect = document.getElementById('ppWallpaperSelect');
    if (ppWallpaperSelect) {
      ppWallpaperSelect.value = me.wallpaper || localStorage.getItem('chatWallpaper') || 'default';
      applyWallpaper(ppWallpaperSelect.value);
    }
    const notif = me.notifications || {};
    if (ppNotifEmail) ppNotifEmail.checked = notif.email === true;
    if (ppNotifPush) ppNotifPush.checked = notif.push === true;
    if (ppNotifSound) ppNotifSound.checked = notif.sound === true;

    // show profile page
    if (profilePage) {
      profilePage.classList.remove('hidden');
      profilePage.classList.add('active');
    }
    if (chatView) chatView.classList.add('hidden');
  } catch (err) {
    console.error('Failed to open profile page', err && err.message ? err.message : err);
  }
}

if (viewProfileBtn) {
  viewProfileBtn.addEventListener('click', (event) => {
    event.preventDefault();
    openProfilePage();
  });
}

const settingsModal = document.getElementById('settingsModal');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettings = document.getElementById('closeSettings');
const smThemeSelect = document.getElementById('smThemeSelect');
const smWallpaperSelect = document.getElementById('smWallpaperSelect');
const smNotifEmail = document.getElementById('smNotifEmail');
const smNotifPush = document.getElementById('smNotifPush');
const smNotifSound = document.getElementById('smNotifSound');
const smChangePassword = document.getElementById('smChangePassword');
const settingsModalForm = document.getElementById('settingsModalForm');
const smAccountEmail = document.getElementById('smAccountEmail');
const smAccountName = document.getElementById('smAccountName');
const settingsNavItems = document.querySelectorAll('.settings-nav-item');
const settingsPanels = document.querySelectorAll('.settings-panel');

function selectSettingsTab(tabId) {
  settingsNavItems.forEach((item) => {
    item.classList.toggle('active', item.dataset.tab === tabId);
  });
  settingsPanels.forEach((panel) => {
    panel.classList.toggle('hidden', panel.id !== tabId);
    panel.classList.toggle('active', panel.id === tabId);
  });
}

function closeSettingsModal() {
  if (!settingsModal) return;
  settingsModal.classList.add('hidden');
  settingsModal.classList.remove('active');
}

async function openSettingsModal() {
  try {
    if (profileMenu) profileMenu.classList.add('hidden');
    const me = await api('/api/me');
    if (smThemeSelect) smThemeSelect.value = me.theme || localStorage.getItem('theme') || 'system';
    if (smWallpaperSelect) smWallpaperSelect.value = me.wallpaper || localStorage.getItem('chatWallpaper') || 'default';
    const notifications = me.notifications || {};
    if (smNotifEmail) smNotifEmail.checked = notifications.email === true;
    if (smNotifPush) smNotifPush.checked = notifications.push === true;
    if (smNotifSound) smNotifSound.checked = notifications.sound === true;
    if (smAccountEmail) smAccountEmail.value = me.email || '';
    if (smAccountName) smAccountName.value = me.displayName || '';
    selectSettingsTab('tabAppearance');
    if (settingsModal) {
      settingsModal.classList.remove('hidden');
      settingsModal.classList.add('active');
    }
  } catch (err) {
    console.error('Failed to open settings modal', err);
  }
}

if (openSettingsBtn) openSettingsBtn.addEventListener('click', (event) => {
  event.preventDefault();
  openSettingsModal();
});
if (closeSettings) closeSettings.addEventListener('click', closeSettingsModal);
settingsNavItems.forEach((item) => {
  item.addEventListener('click', () => selectSettingsTab(item.dataset.tab));
});

if (smChangePassword) smChangePassword.addEventListener('click', () => { closeSettingsModal(); openChangePasswordModal(); });

if (smThemeSelect) smThemeSelect.addEventListener('change', (ev) => applyTheme(ev.target.value));
if (smWallpaperSelect) smWallpaperSelect.addEventListener('change', (ev) => applyWallpaper(ev.target.value));

if (settingsModalForm) {
  settingsModalForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const body = {
        displayName: displayName || localStorage.getItem('chatDisplayName') || '',
        bio: ppEditBio ? ppEditBio.value.trim() : '',
        theme: smThemeSelect ? smThemeSelect.value : 'light',
        wallpaper: smWallpaperSelect ? smWallpaperSelect.value : 'default',
        notifications: {
          email: !!(smNotifEmail && smNotifEmail.checked),
          push: !!(smNotifPush && smNotifPush.checked),
          sound: !!(smNotifSound && smNotifSound.checked),
        }
      };
      const res = await api('/api/me/update', { method: 'POST', body: JSON.stringify(body) });
      if (res && res.token) storeSession({ token: res.token, email: res.email, displayName: res.displayName, profilePicture: res.profilePicture });
      applyTheme(res.theme || smThemeSelect.value);
      applyWallpaper(res.wallpaper || smWallpaperSelect.value);
      alert('Settings saved.');
      closeSettingsModal();
    } catch (err) {
      alert('Failed to save settings: ' + (err && err.message));
    }
  });
}

// Dropdown Logout button
// This control is already queried near the top of this module. Reuse that
// reference so the script remains valid and all authentication code loads.
const menuLogoutControl = menuLogoutBtn;
if (menuLogoutControl) {
  menuLogoutControl.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      if (profileMenu) profileMenu.classList.add('hidden');
      await api('/api/logout', { method: 'POST' });
    } finally {
      showAuth();
    }
  });
}

// choose file & avatar save bar
const ppAvatarActions = document.getElementById('ppAvatarActions');
if (ppChooseBtn && ppFileInput) {
  ppChooseBtn.addEventListener('click', () => ppFileInput.click());
  ppFileInput.addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      _ppSelectedImage = { dataUrl: reader.result, type: f.type };
      if (ppAvatarImg) {
        ppAvatarImg.src = reader.result;
        ppAvatarImg.classList.remove('hidden');
      }
      const ppAvatarInitials = document.getElementById('ppAvatarInitials');
      if (ppAvatarInitials) ppAvatarInitials.classList.add('hidden');
      if (ppAvatarActions) ppAvatarActions.classList.remove('hidden');
    };
    reader.readAsDataURL(f);
  });
}

// save photo
if (ppSavePhoto) {
  ppSavePhoto.addEventListener('click', async () => {
    if (!_ppSelectedImage) return alert('Select an image first');
    try {
      ppSavePhoto.disabled = true;
      const parts = _ppSelectedImage.dataUrl.split(',');
      const base64 = parts[1];
      const type = _ppSelectedImage.type || (_ppSelectedImage.dataUrl.match(/^data:(image\/[^;]+);/) || [])[1] || 'image/png';
      const res = await api('/api/me/photo', { method: 'POST', body: JSON.stringify({ imageBase64: base64, imageType: type }) });
      if (res && res.profilePicture) {
        if (typeof storeSession === 'function') storeSession(res);
        localStorage.setItem('chatProfilePicture', res.profilePicture);
        if (ppAvatarImg) {
          ppAvatarImg.src = res.profilePicture;
          ppAvatarImg.classList.remove('hidden');
        }
        const ppAvatarInitials = document.getElementById('ppAvatarInitials');
        if (ppAvatarInitials) ppAvatarInitials.classList.add('hidden');

        if (headerAvatar) {
          headerAvatar.innerHTML = '';
          const img = document.createElement('img'); img.src = res.profilePicture; img.className = 'avatar-img avatar-mini'; img.alt = res.displayName || '';
          headerAvatar.appendChild(img);
        }
        _ppSelectedImage = null;
        if (ppAvatarActions) ppAvatarActions.classList.add('hidden');
        alert('Profile photo saved.');
        try { await loadRecentChats(); } catch (e) {}
      }
    } catch (err) {
      alert('Failed to upload photo: ' + (err && err.message));
    } finally {
      ppSavePhoto.disabled = false;
    }
  });
}

if (ppCancelPhoto) {
  ppCancelPhoto.addEventListener('click', () => {
    _ppSelectedImage = null;
    if (ppAvatarActions) ppAvatarActions.classList.add('hidden');
    openProfilePage();
  });
}

if (ppSettingsForm) {
  ppSettingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = await api('/api/me/update', {
        method: 'POST',
        body: JSON.stringify({
          displayName: ppEditDisplayName.value.trim(),
          bio: ppEditBio.value.trim(),
          theme: localStorage.getItem('theme') || 'light',
          wallpaper: localStorage.getItem('chatWallpaper') || 'default',
        }),
      });
      storeSession(data);
      displayName = data.displayName || displayName;
      if (data.profilePicture) localStorage.setItem('chatProfilePicture', data.profilePicture);
      alert('Profile saved.');
      closeProfilePage();
    } catch (err) {
      alert('Failed to save profile: ' + (err && err.message));
    }
  });
}

if (ppClose) ppClose.addEventListener('click', closeProfilePage);
if (logoMark) logoMark.addEventListener('click', () => sidebarEl && sidebarEl.classList.toggle('open'));

async function initGoogleSignIn() {
  try {
    const configResponse = await fetch(`${API_BASE_URL}/api/config`);
    if (!configResponse.ok) throw new Error('Unable to load sign-in configuration.');
    const config = await configResponse.json();
    const clientId = config.googleClientId || '';
    const container = document.getElementById('googleSignIn');
    if (!container) return;

    if (!clientId) {
      container.innerHTML = '<button type="button" class="google-btn">Continue with Google</button>';
      container.querySelector('button').addEventListener('click', () => {
        loginError.textContent = 'Google Sign-In is not configured.';
      });
      return;
    }

    const handleCredential = async ({ credential }) => {
      try {
        const data = await api('/api/auth/google', {
          method: 'POST',
          body: JSON.stringify({ idToken: credential }),
        });
        storeSession(data);
        loginError.textContent = '';
        if (data.displayName && String(data.displayName).trim()) showChat();
        else showProfileDetails('');
      } catch (err) {
        loginError.textContent = err.message || 'Google sign-in failed.';
      }
    };

    const waitUntil = Date.now() + 5000;
    while ((!window.google || !window.google.accounts || !window.google.accounts.id) && Date.now() < waitUntil) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
      throw new Error('Google Sign-In could not load.');
    }
    window.google.accounts.id.initialize({ client_id: clientId, callback: handleCredential, ux_mode: 'popup' });
    container.innerHTML = '';
    window.google.accounts.id.renderButton(container, { theme: 'outline', size: 'large', text: 'continue_with' });
  } catch (err) {
    console.error('Failed to initialize Google Sign-In', err);
    if (loginError) loginError.textContent = 'Google Sign-In is temporarily unavailable.';
  }
}

initGoogleSignIn();

setTimeout(() => {
  try {
    const title = document.querySelector('.brand-title');
    const tag = document.querySelector('.brand-tag');
    if (title) title.classList.add('animate');
    if (tag) tag.classList.add('animate');
  } catch (e) {
    // ignore
  }
}, 160);

// Handle profile details submission
profileDetailsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  pdError.textContent = "";
  pdMessage.textContent = "Saving...";
  try {
    const data = await api("/api/me/update", {
      method: "POST",
      body: JSON.stringify({ displayName: pdDisplayName.value.trim() }),
    });
    // store updated token and displayName
    storeSession({ token: data.token, email: data.email, displayName: data.displayName });
    displayName = data.displayName;
    localStorage.setItem("chatDisplayName", displayName);
    pdMessage.textContent = "Profile saved.";
    hideProfileDetails();
    showChat();
  } catch (err) {
    pdError.textContent = err.message;
    pdMessage.textContent = "";
  }
});

document.querySelector("#pdSkip").addEventListener("click", () => {
  // proceed without updating
  hideProfileDetails();
  showChat();
});

// Composer Input Emoji Picker setup
(function setupComposerEmojiPicker() {
  const inputEmojiBtn = document.getElementById('inputEmojiBtn');
  const inputEmojiPicker = document.getElementById('inputEmojiPicker');
  const COMPOSER_EMOJIS = [
    '😊', '😂', '❤️', '👍', '🔥', '🎉', '🙏', '😮', '😢', '😍',
    '🥳', '✨', '👏', '🙌', '😎', '💡', '💯', '🤔', '👋', '👀',
    '⭐', '🚀', '🎁', '💬', '🤩', '💩', '🥳', '😴', '💔', '⚡'
  ];

  if (!inputEmojiBtn || !inputEmojiPicker) return;

  inputEmojiPicker.innerHTML = '';
  COMPOSER_EMOJIS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'input-emoji-item';
    btn.textContent = emoji;
    btn.title = `Insert ${emoji}`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (messageInput) {
        const start = messageInput.selectionStart || messageInput.value.length;
        const end = messageInput.selectionEnd || messageInput.value.length;
        const text = messageInput.value;
        messageInput.value = text.slice(0, start) + emoji + text.slice(end);
        messageInput.selectionStart = messageInput.selectionEnd = start + emoji.length;
        messageInput.focus();
      }
      inputEmojiPicker.classList.add('hidden');
    });
    inputEmojiPicker.appendChild(btn);
  });

  inputEmojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    inputEmojiPicker.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (inputEmojiPicker && !inputEmojiPicker.contains(e.target) && e.target !== inputEmojiBtn) {
      inputEmojiPicker.classList.add('hidden');
    }
  });
})();
