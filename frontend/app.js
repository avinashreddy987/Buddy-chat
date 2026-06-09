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
const profileDetailsView = document.querySelector("#profileDetailsView");
const profileDetailsForm = document.querySelector("#profileDetailsForm");
const pdDisplayName = document.querySelector("#pdDisplayName");
const pdBio = document.querySelector("#pdBio");
const pdMessage = document.querySelector("#pdMessage");
const pdError = document.querySelector("#pdError");

async function api(path, options = {}) {
  const response = await fetch(path, {
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
  localStorage.setItem("chatToken", token);
  localStorage.setItem("chatEmail", email);
  localStorage.setItem("chatDisplayName", displayName);
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
  localStorage.removeItem("chatUsername");
}

function showChat() {
  authView.classList.add("hidden");
  chatView.classList.remove("hidden");
  currentUser.textContent = displayName;
  currentEmail.textContent = email;
  // populate header profile
  headerAvatar.textContent = getInitials(displayName);
  menuDisplayName.textContent = displayName;
  menuEmail.textContent = email;
  connectSocket();
  startUsersRefresh();
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
  socket = io({
    auth: { token },
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
}

function disconnectSocket() {
  if (!socket) return;
  socket.off("users:update", loadUsers);
  socket.off("private:message", handleSocketMessage);
  socket.disconnect();
  socket = null;
}

function setChatTarget(user) {
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

  loadMessages();
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
  usersList.innerHTML = "";

  if (!users.length) {
    const empty = document.createElement("div");
    empty.className = "small-empty";
    empty.textContent = "No other accounts yet.";
    usersList.appendChild(empty);
    return;
  }

  users.forEach((user) => {
    const button = document.createElement("button");
    const avatar = document.createElement("span");
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    const mail = document.createElement("small");
    const presence = document.createElement("i");

    button.type = "button";
    button.className = "user-button";
    button.dataset.email = user.email;
    avatar.className = "avatar";
    avatar.textContent = getInitials(user.displayName);
    copy.className = "user-copy";
    name.textContent = user.displayName;
    mail.textContent = user.email;
    presence.className = `presence ${user.online ? "online" : ""}`;
    presence.setAttribute("aria-label", user.online ? "Online" : "Offline");

    copy.append(name, mail);
    button.append(avatar, copy, presence);
    button.addEventListener("click", () => setChatTarget(user));
    usersList.appendChild(button);
  });

  if (selectedUser) {
    const updatedSelected = users.find((user) => user.email === selectedUser.email);
    if (updatedSelected) {
      selectedUser = updatedSelected;
      chatStatus.textContent = selectedUser.online ? "Online" : "Offline";
    }
  }

  renderActiveUser();
}

function renderMessage(message) {
  const item = document.createElement("article");
  item.className = `message ${message.fromEmail === email ? "mine" : ""}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = message.text;

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${message.fromName} - ${new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;

  item.append(bubble, meta);
  messagesList.appendChild(item);
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
  if (!isSelectedConversation(message) || message.id <= lastMessageId) return;
  renderMessage(message);
  lastMessageId = Math.max(lastMessageId, message.id);
}

async function loadUsers() {
  try {
    const data = await api("/api/users");
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

  try {
    const data = await api("/api/register/verify-otp", {
      method: "POST",
      body: JSON.stringify({ email: pendingEmail, otp: otpInput.value }),
    });
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
    await api("/api/register/complete", {
      method: "POST",
      body: JSON.stringify({
        verificationToken,
        password: passwordInput.value,
      }),
    });

    loginEmailInput.value = pendingEmail;
    loginPasswordInput.value = "";
    passwordInput.value = "";
    confirmPasswordInput.value = "";
    setAuthMode("login");
    loginMessage.textContent = "Account created. Login with your email and password.";
  } catch (error) {
    registerError.textContent = error.message;
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAuthMessages();

  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        email: loginEmailInput.value,
        password: loginPasswordInput.value,
      }),
    });
    storeSession(data);
    loginPasswordInput.value = "";
    // After login, prompt for profile details before entering chat
    showProfileDetails(data.displayName || "");
  } catch (error) {
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

if (token && email) {
  api("/api/me")
    .then((data) => {
      email = data.email;
      displayName = data.displayName;
      localStorage.setItem("chatEmail", email);
      localStorage.setItem("chatDisplayName", displayName);
      // Prompt user to confirm or enter a display name before chat
      showProfileDetails(displayName || "");
    })
    .catch(showAuth);
} else {
  showAuth();
}

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
