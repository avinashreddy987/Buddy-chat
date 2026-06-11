const API_BASE_URL =
  window.location.hostname === "localhost"
    ? "http://localhost:3000"
    : "https://buddy-chat-gz4m.onrender.com";const authView = document.querySelector("#authView");
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
const usersList = document.querySelector("#usersList");
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
const headerAvatar = document.querySelector("#headerAvatar");
const sidebarEl = document.querySelector('.sidebar');
const logoMark = document.querySelector('.logo-mark');

// Change password modal elements
const changePasswordModal = document.querySelector("#changePasswordModal");
const cpCurrentPassword = document.querySelector("#cpCurrentPassword");
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

let cpVerificationToken = "";

let token = localStorage.getItem("chatToken") || "";
let email = localStorage.getItem("chatEmail") || "";
let displayName = localStorage.getItem("chatDisplayName") || "";
let selectedUser = null;
let lastMessageId = 0;
let socket = null;
let usersTimer = null;
let pendingEmail = "";
let verificationToken = "";
let usersCache = [];
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
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
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

// dark mode removed — no-op placeholder
function applyTheme(theme) {
  return;
}

function showProfileDetails(prefill) {
  authView.classList.add("hidden");
  chatView.classList.add("hidden");
  profileDetailsView.classList.remove("hidden");
  pdMessage.textContent = "";
  pdError.textContent = "";
  pdDisplayName.value = prefill || displayName || "";
}

function hideProfileDetails() {
  profileDetailsView.classList.add("hidden");
}

function showAuth() {
  disconnectSocket();
  stopUsersRefresh();
  clearSession();
  authView.classList.remove("hidden");
  chatView.classList.add("hidden");
  setAuthMode("login");
}

function startUsersRefresh() {
  stopUsersRefresh();
  loadUsers();
  usersTimer = setInterval(loadUsers, 15000);
}

function stopUsersRefresh() {
  clearInterval(usersTimer);
}

function connectSocket() {
  disconnectSocket();
socket = io(API_BASE_URL, {
    auth: { token },
    transports: ["websocket", "polling"],
  });

  socket.on("connect", () => {
    chatError.textContent = "";
    loadUsers();
  });

  socket.on("connect_error", (error) => {
    chatError.textContent = error.message || "Socket connection failed.";
  });

  socket.on("users:update", loadUsers);
  socket.on("private:message", handleSocketMessage);
  socket.on("typing", (payload) => {
    if (!payload || !payload.from) return;
    // show typing only when from selected user
    if (selectedUser && payload.from === selectedUser.email) {
      chatStatus.textContent = "Typing...";
      setTimeout(() => {
        chatStatus.textContent = selectedUser.online ? "Online" : "Offline";
      }, 1800);
    }
  });
}

function disconnectSocket() {
  if (!socket) return;
  socket.off("users:update", loadUsers);
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
  // refresh user list to clear badge
  await loadUsers();
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

function renderUsers(users) {
  usersCache = users || [];
  const q = (document.getElementById('usersSearchInput') && document.getElementById('usersSearchInput').value || '').toLowerCase().trim();
  const filtered = usersCache.filter(u => !q || (u.displayName && u.displayName.toLowerCase().includes(q)) || (u.email && u.email.toLowerCase().includes(q)));
  usersList.innerHTML = "";

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "small-empty";
    empty.textContent = "No other accounts yet.";
    usersList.appendChild(empty);
    return;
  }

  filtered.forEach((user) => {
    const button = document.createElement("button");
    const avatar = document.createElement("span");
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    const mail = document.createElement("small");
    const presence = document.createElement("i");

    // Ensure we always have a visible label to display/search
    const display = (user.displayName && String(user.displayName).trim()) || user.email || 'User';

    button.type = "button";
    button.className = "user-button";
    button.dataset.email = user.email;
    avatar.className = "avatar";
    if (user.profilePicture) {
      const img = document.createElement('img');
      img.src = user.profilePicture;
      img.alt = display;
      img.className = 'avatar-img';
      avatar.appendChild(img);
    } else {
      avatar.textContent = getInitials(display);
    }
    copy.className = "user-copy";
    name.textContent = display;
    mail.textContent = user.email;
    presence.className = `presence ${user.online ? "online" : ""}`;
    presence.setAttribute("aria-label", user.online ? "Online" : "Offline");

    copy.append(name, mail);
    // unread badge
    const unread = document.createElement('span');
    unread.className = 'unread';
    if (user.unreadCount && Number(user.unreadCount) > 0) {
      unread.textContent = String(user.unreadCount);
      unread.style.display = '';
    } else {
      unread.style.display = 'none';
    }
    button.append(avatar, copy, presence, unread);
    button.addEventListener("click", () => setChatTarget(user));
    usersList.appendChild(button);
  });

  if (selectedUser) {
    const updatedSelected = usersCache.find((user) => user.email === selectedUser.email);
    if (updatedSelected) {
      selectedUser = updatedSelected;
      chatStatus.textContent = selectedUser.online ? "Online" : "Offline";
    }
  }

  renderActiveUser();
}

function renderMessage(message) {
  const item = document.createElement('article');
  item.className = `message ${message.fromEmail === email ? 'mine' : ''}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = message.text;

  const meta = document.createElement('div');
  meta.className = 'meta';
  const ts = new Date(message.createdAt);
  const time = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const showDate = now - ts.getTime() > day;
  meta.textContent = `${message.fromName} • ${time}${showDate ? ' • ' + ts.toLocaleDateString() : ''}`;

  item.append(bubble, meta);
  messagesList.appendChild(item);
  // auto scroll to latest
  messagesList.scrollTop = messagesList.scrollHeight;
}

function isSelectedConversation(message) {
  return (
    selectedUser &&
    ((message.fromEmail === email && message.toEmail === selectedUser.email) ||
      (message.toEmail === email && message.fromEmail === selectedUser.email))
  );
}

function handleSocketMessage(message) {
  // If message is for current user and not the active conversation, increment unread locally
  if (message.toEmail === email && (!selectedUser || selectedUser.email !== message.fromEmail)) {
    incrementLocalUnread(message.fromEmail);
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

async function loadUsers() {
  try {
    const data = await api("/api/users");
    console.log('DEBUG /api/users response:', data.users);
    renderUsers(data.users);
  } catch (error) {
    chatError.textContent = error.message;
    if (error.message.includes("log in")) showAuth();
  }
}

async function loadMessages() {
  if (!selectedUser) return;

  try {
    const data = await api(
      `/api/messages?with=${encodeURIComponent(selectedUser.email)}&after=${lastMessageId}`
    );
    data.messages.forEach((message) => {
      renderMessage(message);
      lastMessageId = Math.max(lastMessageId, message.id);
    });
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

menuLogoutBtn.addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } finally {
    showAuth();
  }
});

changePasswordBtn.addEventListener("click", () => {
  openChangePasswordModal();
  profileMenu.classList.add("hidden");
});

function openChangePasswordModal() {
  cpVerificationToken = "";
  cpCurrentPassword.value = "";
  cpOtpInput.value = "";
  cpNewPassword.value = "";
  cpConfirmNewPassword.value = "";
  cpStatus.textContent = "";
  cpError.textContent = "";
  // show only current password step
  document.querySelectorAll("#cpStepCurrent, #cpStepOtp, #cpStepNew").forEach((el) => el.classList.add("hidden"));
  document.querySelector("#cpStepCurrent").classList.remove("hidden");
  changePasswordModal.classList.remove("hidden");
}

function closeChangePasswordModal() {
  changePasswordModal.classList.add("hidden");
}

cpCancelBtn.addEventListener("click", closeChangePasswordModal);
closeChangePassword.addEventListener("click", closeChangePasswordModal);

// Send OTP (requires current password validation on server)
cpSendOtpButton.addEventListener("click", async () => {
  cpError.textContent = "";
  cpStatus.textContent = "Sending OTP...";
  cpSendOtpButton.disabled = true;
  try {
    const data = await api("/api/password/send-otp", {
      method: "POST",
      body: JSON.stringify({ currentPassword: cpCurrentPassword.value }),
    });
    cpStatus.textContent = "OTP sent to your email.";
    // show OTP step
    document.querySelectorAll("#cpStepCurrent, #cpStepOtp, #cpStepNew").forEach((el) => el.classList.add("hidden"));
    document.querySelector("#cpStepOtp").classList.remove("hidden");
    cpOtpInput.focus();
  } catch (err) {
    cpError.textContent = err.message;
    cpStatus.textContent = "";
  } finally {
    cpSendOtpButton.disabled = false;
  }
});

cpResendOtpButton.addEventListener("click", async () => {
  cpError.textContent = "";
  cpStatus.textContent = "Resending OTP...";
  cpResendOtpButton.disabled = true;
  try {
    await api("/api/password/send-otp", {
      method: "POST",
      body: JSON.stringify({ currentPassword: cpCurrentPassword.value }),
    });
    cpStatus.textContent = "OTP resent.";
    cpOtpInput.focus();
  } catch (err) {
    cpError.textContent = err.message;
    cpStatus.textContent = "";
  } finally {
    cpResendOtpButton.disabled = false;
  }
});

// Verify OTP
cpVerifyOtpButton.addEventListener("click", async () => {
  cpError.textContent = "";
  cpStatus.textContent = "Verifying code...";
  cpVerifyOtpButton.disabled = true;
  try {
    const data = await api("/api/password/verify-otp", {
      method: "POST",
      body: JSON.stringify({ email, otp: cpOtpInput.value }),
    });
    cpVerificationToken = data.verificationToken;
    cpStatus.textContent = "Code verified. Enter a new password.";
    document.querySelectorAll("#cpStepCurrent, #cpStepOtp, #cpStepNew").forEach((el) => el.classList.add("hidden"));
    document.querySelector("#cpStepNew").classList.remove("hidden");
    cpNewPassword.focus();
  } catch (err) {
    cpError.textContent = err.message;
    cpStatus.textContent = "";
  } finally {
    cpVerifyOtpButton.disabled = false;
  }
});

// Update password
cpUpdateButton.addEventListener("click", async () => {
  cpError.textContent = "";
  if (cpNewPassword.value !== cpConfirmNewPassword.value) {
    cpError.textContent = "Passwords do not match.";
    return;
  }
  cpStatus.textContent = "Updating Password...";
  cpUpdateButton.disabled = true;
  try {
    await api("/api/password/update", {
      method: "POST",
      body: JSON.stringify({ verificationToken: cpVerificationToken, password: cpNewPassword.value }),
    });
    cpStatus.textContent = "Password updated successfully.";
    setTimeout(() => closeChangePasswordModal(), 900);
  } catch (err) {
    cpError.textContent = err.message;
    cpStatus.textContent = "";
  } finally {
    cpUpdateButton.disabled = false;
  }
});

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

// typing indicator: emit when input changes
messageInput.addEventListener('input', () => {
  if (!socket || !socket.connected || !selectedUser) return;
  try {
    socket.emit('typing', { to: selectedUser.email });
  } catch (e) {}
});

// Search input handler
const usersSearchInput = document.getElementById('usersSearchInput');
if (usersSearchInput) {
  usersSearchInput.addEventListener('input', () => {
    renderUsers(usersCache);
  });
}

// Profile modal and actions
const profileModal = document.getElementById('profileModal');
const pmAvatar = document.getElementById('pmAvatar');
const pmDisplayName = document.getElementById('pmDisplayName');
const pmEmail = document.getElementById('pmEmail');
const pmBio = document.getElementById('pmBio');
const pmJoined = document.getElementById('pmJoined');
const pmLastSeen = document.getElementById('pmLastSeen');
const pmEditBtn = document.getElementById('pmEditBtn');
const pmCloseBtn = document.getElementById('pmCloseBtn');
const viewProfileBtn = document.getElementById('viewProfileBtn');
const editProfileBtn = document.getElementById('editProfileBtn');
// Preserve original modal body so we can restore after editing
const originalProfileModalBodyHTML = profileModal && profileModal.querySelector('.modal-body') ? profileModal.querySelector('.modal-body').innerHTML : '';

function closeProfileModal() {
  profileModal.classList.add('hidden');
}

async function openProfileModal() {
  try {
    const data = await api('/api/me');
    // Restore original modal content in case it was replaced by edit form
    const panel = profileModal.querySelector('.modal-body');
    if (originalProfileModalBodyHTML && panel) panel.innerHTML = originalProfileModalBodyHTML;

    // Re-query elements inside restored panel
    const pmAvatarEl = profileModal.querySelector('#pmAvatar');
    const pmDisplayNameEl = profileModal.querySelector('#pmDisplayName');
    const pmEmailEl = profileModal.querySelector('#pmEmail');
    const pmBioEl = profileModal.querySelector('#pmBio');
    const pmJoinedEl = profileModal.querySelector('#pmJoined');
    const pmLastSeenEl = profileModal.querySelector('#pmLastSeen');
    const pmEditBtnEl = profileModal.querySelector('#pmEditBtn');
    const pmCloseBtnEl = profileModal.querySelector('#pmCloseBtn');

    if (pmDisplayNameEl) pmDisplayNameEl.textContent = data.displayName || '';
    if (pmEmailEl) pmEmailEl.textContent = data.email || '';
    if (pmBioEl) pmBioEl.textContent = data.bio || '';
    if (pmJoinedEl) pmJoinedEl.textContent = data.joinedAt ? `Joined ${new Date(data.joinedAt).toLocaleDateString()}` : '';
    if (pmLastSeenEl) pmLastSeenEl.textContent = data.lastSeen ? `Last: ${new Date(data.lastSeen).toLocaleString()}` : '';
    if (pmAvatarEl) {
      if (data.profilePicture) pmAvatarEl.src = data.profilePicture;
      else pmAvatarEl.src = '';
    }

    // Bind close and edit handlers for the restored elements
    if (pmCloseBtnEl && !pmCloseBtnEl.dataset.bound) {
      pmCloseBtnEl.addEventListener('click', () => { closeProfileModal(); showChat(); });
      pmCloseBtnEl.dataset.bound = '1';
    }
    if (pmEditBtnEl && !pmEditBtnEl.dataset.bound) {
      pmEditBtnEl.addEventListener('click', openProfileEdit);
      pmEditBtnEl.dataset.bound = '1';
    }

    profileModal.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to load profile', err);
  }
}

// open modal from profile menu
if (viewProfileBtn) {
  viewProfileBtn.addEventListener('click', (e) => {
    e.preventDefault();
    profileMenu.classList.add('hidden');
    openProfileModal();
  });
}

if (pmCloseBtn) pmCloseBtn.addEventListener('click', () => { closeProfileModal(); showChat(); });

// Edit profile inside modal
async function openProfileEdit() {
  // build an inline form
  try {
    const me = await api('/api/me');
    const form = document.createElement('form');
    form.className = 'profile-edit-form';
    const fldName = document.createElement('label');
    fldName.textContent = 'Display name';
    const inpName = document.createElement('input');
    inpName.name = 'displayName';
    inpName.required = true;
    inpName.value = me.displayName || '';
    fldName.appendChild(inpName);

    const fldBio = document.createElement('label');
    fldBio.textContent = 'Bio';
    const taBio = document.createElement('textarea');
    taBio.name = 'bio';
    taBio.value = me.bio || '';
    fldBio.appendChild(taBio);

    const fldAvatar = document.createElement('label');
    fldAvatar.textContent = 'Avatar URL';
    const inpAvatar = document.createElement('input');
    inpAvatar.name = 'profilePicture';
    inpAvatar.value = me.profilePicture || '';
    fldAvatar.appendChild(inpAvatar);

    // theme selection removed

    const actions = document.createElement('div'); actions.className = 'form-actions';
    const saveBtn = document.createElement('button'); saveBtn.type = 'submit'; saveBtn.textContent = 'Save';
    const cancelBtn = document.createElement('button'); cancelBtn.type = 'button'; cancelBtn.className = 'cancel'; cancelBtn.textContent = 'Cancel';
    actions.append(saveBtn, cancelBtn);

    form.append(fldName, fldBio, fldAvatar, actions);
    const panel = profileModal.querySelector('.modal-body');
    panel.innerHTML = '';
    panel.appendChild(form);
    cancelBtn.addEventListener('click', () => { closeProfileModal(); showChat(); });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = {
        displayName: inpName.value,
        bio: taBio.value,
        profilePicture: inpAvatar.value
      };
      try {
        const data = await api('/api/me/update', { method: 'POST', body: JSON.stringify(body) });
        storeSession({ token: data.token, email: data.email, displayName: data.displayName, profilePicture: data.profilePicture });
        displayName = data.displayName;
        if (data.profilePicture) localStorage.setItem('chatProfilePicture', data.profilePicture);
        // close modal and return to chat (home)
        closeProfileModal();
        showChat();
      } catch (err) {
        alert('Failed to save: ' + err.message);
      }
    });
  } catch (err) {
    alert('Failed to load profile for edit');
  }
}

// Bind initial pmEditBtn to the edit function if present
if (pmEditBtn) pmEditBtn.addEventListener('click', openProfileEdit);

// also bind the menu-level edit button to open the modal in edit mode
if (editProfileBtn) {
  editProfileBtn.addEventListener('click', (e) => { e.preventDefault(); profileMenu.classList.add('hidden'); const btn = document.getElementById('pmEditBtn'); if (btn) btn.click(); });
}

// Defensive binding: ensure profile menu actions are attached when menu is opened
function bindProfileMenuActions() {
  const v = document.getElementById('viewProfileBtn');
  const ebtn = document.getElementById('editProfileBtn');
  if (v && !v.dataset.bound) {
    v.addEventListener('click', (ev) => { ev.preventDefault(); profileMenu.classList.add('hidden'); openProfileModal(); });
    v.dataset.bound = '1';
  }
  if (ebtn && !ebtn.dataset.bound) {
    ebtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      profileMenu.classList.add('hidden');
      // open modal first, then enter edit mode
      openProfileModal().then(() => setTimeout(() => { const btn = document.getElementById('pmEditBtn'); if (btn) btn.click(); }, 60));
    });
    ebtn.dataset.bound = '1';
  }
}

// Bind once on load
bindProfileMenuActions();
// Re-bind when toggling the profile menu
profileButton.addEventListener('click', bindProfileMenuActions);

// Bind mobile sidebar toggle
if (logoMark) {
  logoMark.addEventListener('click', () => { if (sidebarEl) sidebarEl.classList.toggle('open'); });
}

if (token && email) {
  api("/api/me")
    .then((data) => {
      email = data.email;
      displayName = data.displayName;
      localStorage.setItem("chatEmail", email);
      localStorage.setItem("chatDisplayName", displayName);
      // Only prompt for profile details if displayName is missing
      if (displayName && String(displayName).trim()) {
        showChat();
      } else {
        showProfileDetails(displayName || "");
      }
    })
    .catch(showAuth);
} else {
  showAuth();
}

// Initialize Google Sign-In button (if configured)
async function initGoogleSignIn() {
  try {
    const cfg = await fetch(`${API_BASE_URL}/api/config`)
      .then((r) => r.json());
    const clientId = cfg.googleClientId || "";
    const container = document.getElementById('googleSignIn');
    // Always render a visible button so users see the option.
    if (container && !clientId) {
      container.innerHTML = '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'google-btn';
      btn.disabled = true;
      btn.textContent = 'Continue with Google (configure GOOGLE_CLIENT_ID)';
      btn.addEventListener('click', () => {
        loginError.textContent = 'Google Sign-In is not configured. Set GOOGLE_CLIENT_ID in .env.';
      });
      container.appendChild(btn);
      return;
    }

    const handleCredentialResponse = async (resp) => {
      try {
        const data = await api('/api/auth/google', {
          method: 'POST',
          body: JSON.stringify({ idToken: resp.credential }),
        });
        storeSession(data);
        // Always prompt for profile details after first sign-in so users can confirm/edit
        displayName = data.displayName || '';
        localStorage.setItem('chatDisplayName', displayName);
        if (data.profilePicture) localStorage.setItem('chatProfilePicture', data.profilePicture);
        showProfileDetails(displayName || '');
      } catch (err) {
        loginError.textContent = err.message || 'Google sign-in failed.';
      }
    };

    // Wait for google.accounts to be available
    const waitForGoogle = () => new Promise((resolve) => {
      if (window.google && google.accounts && google.accounts.id) return resolve();
      const to = setInterval(() => {
        if (window.google && google.accounts && google.accounts.id) {
          clearInterval(to);
          resolve();
        }
      }, 200);
      setTimeout(() => resolve(), 3000);
    });

    await waitForGoogle();
    if (!window.google || !google.accounts || !google.accounts.id) return;

    google.accounts.id.initialize({
      client_id: clientId,
      callback: handleCredentialResponse,
      ux_mode: 'popup',
    });

    // Render Google's official button inside our container
    if (container) {
      container.innerHTML = '';
      google.accounts.id.renderButton(container, { theme: 'outline', size: 'large', text: 'continue_with' });
    }
  } catch (err) {
    console.error('Failed to initialize Google Sign-In', err);
  }
}

initGoogleSignIn();

// Trigger animated 3D entrance for the brand title and tagline
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
