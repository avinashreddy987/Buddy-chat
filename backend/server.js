const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const { Resend } = require("resend");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.resolve(__dirname, "..", "frontend");
const JWT_SECRET = process.env.JWT_SECRET || "local-development-secret-change-this";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const OTP_TTL_MS = 10 * 60 * 1000;
const VERIFIED_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const resend = new Resend(process.env.RESEND_API_KEY);

if (!process.env.JWT_SECRET) {
  console.warn("JWT_SECRET is not set. Add a strong JWT_SECRET in .env before production use.");
}

const users = new Map();
const pendingOtps = new Map();
const verifiedRegistrations = new Map();
const activeUsers = new Map();
const messages = [];

// MongoDB: optional persistence for users so credentials survive restarts
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const MONGODB_DB = process.env.MONGODB_DB || "chatbot";
let db = null;
let usersCollection = null;

async function initDb() {
  try {
    const client = new MongoClient(MONGODB_URI, { serverApi: { version: "1" } });
    await client.connect();
    db = client.db(MONGODB_DB);
    usersCollection = db.collection("users");

    const all = await usersCollection.find({}).toArray();
    for (const u of all) {
      users.set(u.email, {
        email: u.email,
        displayName: u.displayName,
        passwordHash: u.passwordHash,
        passwordSalt: u.passwordSalt,
        joinedAt: u.joinedAt || Date.now(),
        lastSeen: u.lastSeen || Date.now(),
      });
    }
    console.log(`Loaded ${all.length} users from MongoDB`);
  } catch (err) {
    console.warn("Could not connect to MongoDB, falling back to in-memory store:", err.message || err);
  }
}

async function saveUserToDb(user) {
  if (!usersCollection || !user || !user.email) return;
  try {
    await usersCollection.updateOne({ email: user.email }, { $set: user }, { upsert: true });
  } catch (err) {
    console.warn("Failed to save user to MongoDB:", err && err.message ? err.message : err);
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function getDisplayName(email) {
  const localPart = email.split("@")[0] || "User";
  return localPart.replace(/[._-]+/g, " ").trim().slice(0, 32) || "User";
}

function hashSecret(secret, salt) {
  return crypto.scryptSync(secret, salt, 64).toString("hex");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: hashSecret(password, salt) };
}

function safeEqualHex(left, right) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyPassword(password, user) {
  return safeEqualHex(hashSecret(password, user.passwordSalt), user.passwordHash);
}

function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

function hashOtp(email, otp, salt) {
  return crypto.createHash("sha256").update(`${email}:${otp}:${salt}`).digest("hex");
}

function conversationKey(a, b) {
  return [a, b].sort((left, right) => left.localeCompare(right)).join("::");
}

function requirePassword(password) {
  const value = String(password || "");
  if (value.length < 8) return "Password must be at least 8 characters.";
  if (value.length > 128) return "Password must be 128 characters or fewer.";
  return "";
}

function createJwt(user) {
  return jwt.sign(
    {
      email: user.email,
      displayName: user.displayName,
    },
    JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
      issuer: "one-to-one-chat",
      subject: user.email,
    }
  );
}

function verifyJwtToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { issuer: "one-to-one-chat" });
  } catch {
    return null;
  }
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function getSession(req) {
  const payload = verifyJwtToken(getBearerToken(req));
  if (!payload) return null;

  const email = normalizeEmail(payload.sub || payload.email);
  const user = users.get(email);
  if (!user) return null;
  user.lastSeen = Date.now();
  // persist lastSeen asynchronously
  saveUserToDb(user).catch(() => {});
  return { email, user };
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  if (!host || !user || !pass || !from) {
    throw new Error(
      "Email service is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM in .env."
    );
  }

  return { host, port, user, pass, from, secure };
}

async function sendOtpEmail(email, otp) {
  try {
    const result = await resend.emails.send({
      from: "onboarding@resend.dev",
      to: email,
      subject: "Your Chat Verification Code",
      html: `
        <div style="font-family:Arial,sans-serif">
          <h2>Your Verification Code</h2>
          <p>Use this OTP to verify your account:</p>
          <h1>${otp}</h1>
          <p>This code expires in 10 minutes.</p>
        </div>
      `,
    });

    console.log("Email sent successfully:", result);
    return result;

  } catch (err) {
    console.error("Resend Error:", err);
    throw err;
  }
}

function getPublicUser(user) {
  return {
    email: user.email,
    displayName: user.displayName,
    online: activeUsers.has(user.email),
    lastSeen: user.lastSeen,
  };
}

function getUsersFor(email) {
  return [...users.values()]
    .filter((user) => user.email !== email)
    .map(getPublicUser)
    .sort((a, b) => Number(b.online) - Number(a.online) || b.lastSeen - a.lastSeen);
}

function createMessage({ sender, toEmail, text }) {
  const recipient = users.get(toEmail);
  const cleanText = String(text || "").trim().slice(0, 1000);

  if (!recipient) {
    throw new Error("Choose a user to chat with.");
  }

  if (recipient.email === sender.email) {
    throw new Error("Pick another user.");
  }

  if (!cleanText) {
    throw new Error("Type a message first.");
  }

  const message = {
    id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
    chat: conversationKey(sender.email, recipient.email),
    fromEmail: sender.email,
    fromName: sender.displayName,
    toEmail: recipient.email,
    toName: recipient.displayName,
    text: cleanText,
    createdAt: Date.now(),
  };

  messages.push(message);
  return message;
}

async function handleRegisterRequest(req, res) {
  const body = await readBody(req);
  const email = normalizeEmail(body.email);

  if (!isValidEmail(email)) {
    return sendJson(res, 400, { error: "Enter a valid email address." });
  }

  if (users.has(email)) {
    return sendJson(res, 409, { error: "An account already exists for this email." });
  }

  const otp = generateOtp();
  const otpSalt = crypto.randomBytes(16).toString("hex");
  // Persist the OTP info first so the API can return quickly.
  pendingOtps.set(email, {
    otpHash: hashOtp(email, otp, otpSalt),
    otpSalt,
    attempts: 0,
    expiresAt: Date.now() + OTP_TTL_MS,
    emailSent: false,
    sentAt: null,
    emailError: null,
  });
  // If the user is requesting an OTP for the same address used for SMTP
  // (common during testing) send synchronously and return delivery info so
  // the requester can see a preview or messageId immediately. Otherwise
  // send in background for speed.
  try {
    const smtpCfg = (() => {
      try {
        return getSmtpConfig();
      } catch {
        return null;
      }
    })();

    const smtpUser = smtpCfg && smtpCfg.user ? normalizeEmail(smtpCfg.user) : "";
    const smtpFrom = smtpCfg && smtpCfg.from ? normalizeEmail(smtpCfg.from) : "";

    if (smtpUser && (smtpUser === email || smtpFrom === email)) {
      // synchronous send for immediate feedback during testing
      try {
        const info = await sendOtpEmail(email, otp);
        const rec = pendingOtps.get(email);
        if (rec) {
          rec.emailSent = true;
          rec.sentAt = Date.now();
          rec.emailInfo = info && info.messageId ? { messageId: info.messageId } : null;
          rec.emailPreview = nodemailer.getTestMessageUrl(info) || null;
        }
        return sendJson(res, 200, { ok: true, email, sent: true, emailInfo: rec.emailInfo, preview: rec.emailPreview });
      } catch (err) {
        const rec = pendingOtps.get(email);
        if (rec) rec.emailError = err && err.message ? err.message : String(err);
        return sendJson(res, 502, { error: "Failed to send verification email (test mode).", detail: rec.emailError });
      }
    }
  } catch (e) {
    // ignore smtp detection errors and fall back to background send
  }

  // Send the email asynchronously; don't block the request on SMTP latency.
  (async () => {
    try {
      const info = await sendOtpEmail(email, otp);
      const rec = pendingOtps.get(email);
      if (rec) {
        rec.emailSent = true;
        rec.sentAt = Date.now();
        rec.emailInfo = info && info.messageId ? { messageId: info.messageId } : null;
      }
    } catch (err) {
      const rec = pendingOtps.get(email);
      if (rec) {
        rec.emailError = err && err.message ? err.message : String(err);
      }
      console.error("Failed to send OTP email (background):", err && err.message ? err.message : err);
    }
  })();

  return sendJson(res, 200, { ok: true, email });
}

async function handleVerifyOtp(req, res) {
  const body = await readBody(req);
  const email = normalizeEmail(body.email);
  const otp = String(body.otp || "").trim();
  const pending = pendingOtps.get(email);

  if (!pending) {
    return sendJson(res, 400, { error: "Request a new verification code." });
  }

  if (Date.now() > pending.expiresAt) {
    pendingOtps.delete(email);
    return sendJson(res, 400, { error: "Verification code expired. Request a new one." });
  }

  if (pending.attempts >= MAX_OTP_ATTEMPTS) {
    pendingOtps.delete(email);
    return sendJson(res, 429, { error: "Too many wrong codes. Request a new one." });
  }

  const otpHash = hashOtp(email, otp, pending.otpSalt);
  if (!safeEqualHex(otpHash, pending.otpHash)) {
    pending.attempts += 1;
    return sendJson(res, 400, { error: "Incorrect verification code." });
  }

  pendingOtps.delete(email);
  const verificationToken = crypto.randomBytes(24).toString("hex");
  verifiedRegistrations.set(verificationToken, {
    email,
    expiresAt: Date.now() + VERIFIED_TTL_MS,
  });

  return sendJson(res, 200, { verificationToken });
}

// Password reset: send OTP to logged-in user's email after validating current password
async function handlePasswordSendOtp(req, res) {
  const session = getSession(req);
  if (!session) return sendJson(res, 401, { error: "Please log in again." });

  const body = await readBody(req);
  const current = String(body.currentPassword || "");

  if (!verifyPassword(current, session.user)) {
    return sendJson(res, 401, { error: "Current password is incorrect." });
  }

  const email = session.user.email;
  const otp = generateOtp();
  const otpSalt = crypto.randomBytes(16).toString("hex");

  pendingOtps.set(email, {
    otpHash: hashOtp(email, otp, otpSalt),
    otpSalt,
    attempts: 0,
    expiresAt: Date.now() + OTP_TTL_MS,
    emailSent: false,
    sentAt: null,
    emailError: null,
    purpose: "password-reset",
  });

  try {
    const smtpCfg = (() => {
      try {
        return getSmtpConfig();
      } catch {
        return null;
      }
    })();

    const smtpUser = smtpCfg && smtpCfg.user ? normalizeEmail(smtpCfg.user) : "";
    const smtpFrom = smtpCfg && smtpCfg.from ? normalizeEmail(smtpCfg.from) : "";

    if (smtpUser && (smtpUser === email || smtpFrom === email)) {
      try {
        const info = await sendOtpEmail(email, otp);
        const rec = pendingOtps.get(email);
        if (rec) {
          rec.emailSent = true;
          rec.sentAt = Date.now();
          rec.emailInfo = info && info.messageId ? { messageId: info.messageId } : null;
          rec.emailPreview = nodemailer.getTestMessageUrl(info) || null;
        }
        return sendJson(res, 200, { ok: true, email, sent: true, preview: rec.emailPreview });
      } catch (err) {
        const rec = pendingOtps.get(email);
        if (rec) rec.emailError = err && err.message ? err.message : String(err);
        return sendJson(res, 502, { error: "Failed to send verification email (test mode)." });
      }
    }
  } catch (e) {
    // ignore smtp detection errors
  }

  (async () => {
    try {
      const info = await sendOtpEmail(email, otp);
      const rec = pendingOtps.get(email);
      if (rec) {
        rec.emailSent = true;
        rec.sentAt = Date.now();
        rec.emailInfo = info && info.messageId ? { messageId: info.messageId } : null;
      }
    } catch (err) {
      const rec = pendingOtps.get(email);
      if (rec) {
        rec.emailError = err && err.message ? err.message : String(err);
      }
      console.error("Failed to send OTP email (background):", err && err.message ? err.message : err);
    }
  })();

  return sendJson(res, 200, { ok: true, email });
}

// Verify OTP for password-reset purpose
async function handlePasswordVerifyOtp(req, res) {
  const body = await readBody(req);
  const email = normalizeEmail(body.email);
  const otp = String(body.otp || "").trim();
  const pending = pendingOtps.get(email);

  if (!pending || pending.purpose !== "password-reset") {
    return sendJson(res, 400, { error: "Request a new verification code." });
  }

  if (Date.now() > pending.expiresAt) {
    pendingOtps.delete(email);
    return sendJson(res, 400, { error: "Verification code expired. Request a new one." });
  }

  if (pending.attempts >= MAX_OTP_ATTEMPTS) {
    pendingOtps.delete(email);
    return sendJson(res, 429, { error: "Too many wrong codes. Request a new one." });
  }

  const otpHash = hashOtp(email, otp, pending.otpSalt);
  if (!safeEqualHex(otpHash, pending.otpHash)) {
    pending.attempts += 1;
    return sendJson(res, 400, { error: "Incorrect verification code." });
  }

  pendingOtps.delete(email);
  const verificationToken = crypto.randomBytes(24).toString("hex");
  verifiedRegistrations.set(verificationToken, {
    email,
    purpose: "password-reset",
    expiresAt: Date.now() + VERIFIED_TTL_MS,
  });

  return sendJson(res, 200, { verificationToken });
}

// Complete password update after OTP verification
async function handlePasswordUpdate(req, res) {
  const body = await readBody(req);
  const verificationToken = String(body.verificationToken || "");
  const password = String(body.password || "");
  const verified = verifiedRegistrations.get(verificationToken);

  if (!verified || Date.now() > verified.expiresAt || verified.purpose !== "password-reset") {
    verifiedRegistrations.delete(verificationToken);
    return sendJson(res, 400, { error: "Verification expired. Start again." });
  }

  const passwordError = requirePassword(password);
  if (passwordError) {
    return sendJson(res, 400, { error: passwordError });
  }

  const user = users.get(verified.email);
  if (!user) {
    verifiedRegistrations.delete(verificationToken);
    return sendJson(res, 404, { error: "User not found." });
  }

  const passwordData = hashPassword(password);
  user.passwordHash = passwordData.hash;
  user.passwordSalt = passwordData.salt;
  saveUserToDb(user).catch(() => {});
  verifiedRegistrations.delete(verificationToken);

  return sendJson(res, 200, { ok: true });
}

async function handleCompleteRegistration(req, res) {
  const body = await readBody(req);
  const verificationToken = String(body.verificationToken || "");
  const password = String(body.password || "");
  const verified = verifiedRegistrations.get(verificationToken);

  if (!verified || Date.now() > verified.expiresAt) {
    verifiedRegistrations.delete(verificationToken);
    return sendJson(res, 400, { error: "Verification expired. Start again." });
  }

  const passwordError = requirePassword(password);
  if (passwordError) {
    return sendJson(res, 400, { error: passwordError });
  }

  if (users.has(verified.email)) {
    verifiedRegistrations.delete(verificationToken);
    return sendJson(res, 409, { error: "An account already exists for this email." });
  }

  const passwordData = hashPassword(password);
  users.set(verified.email, {
    email: verified.email,
    displayName: getDisplayName(verified.email),
    passwordHash: passwordData.hash,
    passwordSalt: passwordData.salt,
    joinedAt: Date.now(),
    lastSeen: Date.now(),
  });
  // persist new user
  saveUserToDb(users.get(verified.email)).catch(() => {});
  verifiedRegistrations.delete(verificationToken);

  return sendJson(res, 201, { ok: true, email: verified.email });
}

async function handleLogin(req, res) {
  const body = await readBody(req);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const user = users.get(email);

  if (!user || !verifyPassword(password, user)) {
    return sendJson(res, 401, { error: "Invalid email or password." });
  }

  user.lastSeen = Date.now();
  // persist updated lastSeen
  saveUserToDb(user).catch(() => {});
  return sendJson(res, 200, {
    token: createJwt(user),
    email: user.email,
    displayName: user.displayName,
  });
}

async function handleApi(req, res) {
  if (req.method === "POST" && req.url === "/api/register/request-otp") {
    return handleRegisterRequest(req, res);
  }

  if (req.method === "POST" && req.url === "/api/register/verify-otp") {
    return handleVerifyOtp(req, res);
  }

  if (req.method === "POST" && req.url === "/api/register/complete") {
    return handleCompleteRegistration(req, res);
  }

  if (req.method === "POST" && req.url === "/api/login") {
    return handleLogin(req, res);
  }

  if (req.method === "POST" && req.url === "/api/logout") {
    return sendJson(res, 200, { ok: true });
  }

  // Password reset endpoints (require authentication for sending OTP)
  if (req.method === "POST" && req.url === "/api/password/send-otp") {
    return handlePasswordSendOtp(req, res);
  }

  if (req.method === "POST" && req.url === "/api/password/verify-otp") {
    return handlePasswordVerifyOtp(req, res);
  }

  if (req.method === "POST" && req.url === "/api/password/update") {
    return handlePasswordUpdate(req, res);
  }

  const session = getSession(req);
  if (!session) {
    return sendJson(res, 401, { error: "Please log in again." });
  }

  if (req.method === "GET" && req.url === "/api/me") {
    return sendJson(res, 200, {
      email: session.user.email,
      displayName: session.user.displayName,
    });
  }

  if (req.method === "POST" && req.url === "/api/me/update") {
    // update current user's profile (displayName)
    const body = await readBody(req);
    const displayName = String((body.displayName || "")).trim().slice(0, 60);

    if (!displayName) {
      return sendJson(res, 400, { error: "Display name is required." });
    }

    session.user.displayName = displayName;
    // persist
    saveUserToDb(session.user).catch(() => {});

    // issue a new token so clients can keep displayName in JWT
    const token = createJwt(session.user);
    return sendJson(res, 200, { ok: true, token, email: session.user.email, displayName: session.user.displayName });
  }

  if (req.method === "GET" && req.url === "/api/users") {
    return sendJson(res, 200, { users: getUsersFor(session.email) });
  }

  if (req.method === "GET" && req.url.startsWith("/api/messages")) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const withEmail = normalizeEmail(url.searchParams.get("with"));
    const after = Number(url.searchParams.get("after") || 0);

    if (!withEmail || !users.has(withEmail)) {
      return sendJson(res, 404, { error: "User not found." });
    }

    const key = conversationKey(session.email, withEmail);
    const chat = messages.filter((message) => message.chat === key && message.id > after);
    return sendJson(res, 200, { messages: chat });
  }

  if (req.method === "POST" && req.url === "/api/messages") {
    const body = await readBody(req);
    const message = createMessage({
      sender: session.user,
      toEmail: normalizeEmail(body.to),
      text: body.text,
    });

    io.to(`user:${message.fromEmail}`).to(`user:${message.toEmail}`).emit("private:message", message);
    return sendJson(res, 201, { message });
  }

  return sendJson(res, 404, { error: "Not found." });
}

function serveStatic(req, res) {
  const rawPath = req.url === "/" ? "index.html" : req.url.split("?")[0];
  const safePath = path
    .normalize(decodeURIComponent(rawPath))
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]+/, "");
  const filePath = path.resolve(FRONTEND_DIR, safePath);

  if (!filePath.startsWith(`${FRONTEND_DIR}${path.sep}`) && filePath !== FRONTEND_DIR) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }

    const ext = path.extname(filePath);
    const type =
      ext === ".html" ? "text/html" : ext === ".css" ? "text/css" : "application/javascript";

    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch((error) => sendJson(res, 400, { error: error.message }));
    return;
  }

  serveStatic(req, res);
});

const io = new Server(server);

function broadcastUsersUpdate() {
  io.emit("users:update");
}

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const payload = verifyJwtToken(token);

  if (!payload) {
    next(new Error("Unauthorized"));
    return;
  }

  const email = normalizeEmail(payload.sub || payload.email);
  const user = users.get(email);

  if (!user) {
    next(new Error("Unauthorized"));
    return;
  }

  socket.user = user;
  next();
});

io.on("connection", (socket) => {
  const user = socket.user;
  activeUsers.set(user.email, (activeUsers.get(user.email) || 0) + 1);
  user.lastSeen = Date.now();
  saveUserToDb(user).catch(() => {});
  socket.join(`user:${user.email}`);
  broadcastUsersUpdate();

  socket.on("private:message", (payload, callback) => {
    try {
      const message = createMessage({
        sender: user,
        toEmail: normalizeEmail(payload && payload.to),
        text: payload && payload.text,
      });

      io.to(`user:${message.fromEmail}`)
        .to(`user:${message.toEmail}`)
        .emit("private:message", message);
      if (typeof callback === "function") callback({ ok: true, message });
    } catch (error) {
      if (typeof callback === "function") callback({ ok: false, error: error.message });
    }
  });

  socket.on("disconnect", () => {
    const count = activeUsers.get(user.email) || 0;
    if (count <= 1) {
      activeUsers.delete(user.email);
      user.lastSeen = Date.now();
      saveUserToDb(user).catch(() => {});
    } else {
      activeUsers.set(user.email, count - 1);
    }
    broadcastUsersUpdate();
  });
});

function tryListen(port, attemptsLeft = 5) {
  server.once("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      if (attemptsLeft > 0) {
        console.warn(`Port ${port} in use, trying ${port + 1}...`);
        setTimeout(() => tryListen(port + 1, attemptsLeft - 1), 300);
        return;
      }
      console.error(`Port ${port} in use and no retries left. Exiting.`);
      process.exit(1);
    }
    console.error("Server error:", err && err.message ? err.message : err);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`Chat app running at http://localhost:${port}`);
  });
}

initDb()
  .catch(() => {})
  .finally(() => {
    tryListen(Number(PORT) || 3000);
  });
