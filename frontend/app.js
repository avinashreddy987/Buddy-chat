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
const logoutButton = document.querySelector("#logoutButton");
const usersList = document.querySelector("#usersList");
const chatTitle = document.querySelector("#chatTitle");
const chatStatus = document.querySelector("#chatStatus");
const emptyState = document.querySelector("#emptyState");
const messagesList = document.querySelector("#messagesList");
const messageForm = document.querySelector("#messageForm");
const messageInput = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const chatError = document.querySelector("#chatError");

let token = localStorage.getItem("chatToken") || "";
let email = localStorage.getItem("chatEmail") || "";
let displayName = localStorage.getItem("chatDisplayName") || "";
let selectedUser = null;
let lastMessageId = 0;
let socket = null;
let usersTimer = null;
let pendingEmail = "";
let verificationToken = "";

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
  connectSocket();
  startUsersRefresh();
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
    showChat();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } finally {
    showAuth();
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
      showChat();
    })
    .catch(showAuth);
} else {
  showAuth();
}
