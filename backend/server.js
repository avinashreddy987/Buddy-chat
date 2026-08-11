require("dotenv").config();
const dns = require("dns");
try {
  dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
} catch (err) {
  console.warn("Could not set DNS fallback servers:", err);
}
console.log("MONGODB_URI =", process.env.MONGODB_URI);

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const jwt = require("jsonwebtoken");
const { Resend } = require("resend");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");
const { OAuth2Client } = require("google-auth-library");
const bcrypt = require('bcryptjs');

// Allowed frontend origins. Add your Vercel frontend URL here.
// Use '*' to allow any origin (useful for testing but not recommended for production).
const allowedOrigins = [
  "https://buddychat-self.vercel.app",
  "https://buddy-chat-self.vercel.app",
  "http://localhost:3000",
  "*",
];

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.resolve(__dirname, "..", "frontend");
const JWT_SECRET = process.env.JWT_SECRET || "local-development-secret-change-this";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const OTP_TTL_MS = 10 * 60 * 1000;
const VERIFIED_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const resend = new Resend(process.env.RESEND_API_KEY);
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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
let messagesCollection = null;

(async () => {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    console.log("✅ ATLAS CONNECTION SUCCESS");
    await client.close();
  } catch (err) {
    console.error("❌ ATLAS TEST FAILED:", err);
  }
})();
 
async function initDb() {
  try {
    const client = new MongoClient(MONGODB_URI, { serverApi: { version: "1" } });
    await client.connect();
    db = client.db(MONGODB_DB);
    usersCollection = db.collection("users");
    messagesCollection = db.collection("messages");

    await messagesCollection.createIndex({
      chat: 1,
      createdAt: 1
    });
    // Additional indexes to support recent-chats and search queries
    try {
      await messagesCollection.createIndex({ fromEmail: 1, toEmail: 1, createdAt: -1 });
    } catch (e) {}
    try {
      await usersCollection.createIndex({ email: 1 });
      await usersCollection.createIndex({ displayName: 1 });
    } catch (e) {}
    // Log some diagnostics about the MongoDB connection (mask credentials)
    try {
      const masked = (MONGODB_URI || '').replace(/:(?:\\\/\\\/)?([^@]+)@/, ':***@');
      console.log('MONGODB_URI (masked):', masked || '(not set)');
    } catch (e) {}

    const all = await usersCollection.find({}).toArray();
    try {
      const count = await usersCollection.countDocuments();
      console.log(`Users in MongoDB collection: ${count}`);
    } catch (e) {}
    for (const u of all) {
      users.set(u.email, {
        email: u.email,
        displayName: u.displayName,
        passwordHash: u.passwordHash,
        passwordSalt: u.passwordSalt,
        authProvider: u.authProvider || "local",
        googleId: u.googleId || null,
        profilePicture: u.profilePicture || null,
        bio: u.bio || "",
        theme: u.theme || "light",
        joinedAt: u.joinedAt || Date.now(),
        lastSeen: u.lastSeen || Date.now(),
        unread: u.unread || {},
      });
    }
    console.log(`Loaded ${all.length} users from MongoDB into memory. users Map size=${users.size}`);
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
      // Allow up to ~10MB for base64 audio uploads sent as JSON
      if (body.length > 10_000_000) {
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

console.log("✅ isValidEmail loaded successfully");

function getDisplayName(email) {
  const localPart = email.split("@")[0] || "User";
  return localPart.replace(/[._-]+/g, " ").trim().slice(0, 32) || "User";
}

function hashSecret(secret, salt) {
  return crypto.scryptSync(secret, salt, 64).toString("hex");
}

function hashPassword(password) {
  // bcrypt handles salting internally. We still return a salt field for
  // compatibility with older records (set to an empty string when using bcrypt).
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(password, salt);
  return { salt, hash };
}

function verifyPassword(password, user) {
  try {
    if (!user || !user.passwordHash) return false;
    return bcrypt.compareSync(password, user.passwordHash);
  } catch (err) {
    return false;
  }
}

function safeEqualHex(left, right) {
  try {
    const leftBuffer = Buffer.from(left, "hex");
    const rightBuffer = Buffer.from(right, "hex");
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
  } catch (e) {
    return false;
  }
}

// Backwards compatibility: support legacy scrypt-based hashes stored as hex.
function verifyPasswordWithFallback(password, user) {
  // First try bcrypt (new users)
  if (verifyPassword(password, user)) return true;
  // If bcrypt failed, try legacy scrypt hash when salt exists
  try {
    if (user && user.passwordSalt && user.passwordHash) {
      const candidate = hashSecret(password, user.passwordSalt);
      if (safeEqualHex(candidate, user.passwordHash)) return true;
    }
  } catch (e) {}
  return false;
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

// Resend is used for all email delivery; remove legacy SMTP/Nodemailer helpers.

async function sendOtpEmail(email, otp) {
  try {
    console.log("Sending OTP via Resend...");
    console.log("RESEND KEY EXISTS:", !!process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: "onboarding@sumukesh.app",
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

    console.log("RESEND RESULT:", JSON.stringify(result, null, 2));

    if (result.error) {
      console.error("RESEND ERROR:", result.error);
      throw new Error(result.error.message || "Failed to send email");
    }

    console.log("OTP email sent successfully");
    return result;
  } catch (err) {
    console.error("Resend Error:", err && err.message ? err.message : err);
    throw err;
  }
}

function getPublicUser(user) {
  return {
    email: user.email,
    displayName: user.displayName,
    online: activeUsers.has(user.email),
    lastSeen: user.lastSeen,
    profilePicture: user.profilePicture || null,
    authProvider: user.authProvider || "local",
    bio: user.bio || "",
    joinedAt: user.joinedAt || Date.now(),
    // `unreadCount` will be filled by getUsersFor(requester)
    unreadCount: 0,
  };
}

function getUsersFor(email) {
  return [...users.values()]
    .filter((user) => user.email !== email)
    .map((user) => ({
      email: user.email,
      displayName: user.displayName || getDisplayName(user.email),
      online: activeUsers.has(user.email),
      profilePicture: user.profilePicture || null,
      lastSeen: user.lastSeen || Date.now(),
      unreadCount: user.unread?.[email] || 0,
    }));
}

function createMessage({ sender, toEmail, text, audioUrl = null, audioDuration = null, edited = false, deleted = false }) {
  const recipient = users.get(toEmail);
  const cleanText = String(text || "").trim().slice(0, 1000);

  if (!recipient) {
    throw new Error("Choose a user to chat with.");
  }

  if (recipient.email === sender.email) {
    throw new Error("Pick another user.");
  }

  if (!cleanText && !audioUrl) {
    throw new Error("Type a message or record audio first.");
  }

  const message = {
    id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
    chat: conversationKey(sender.email, recipient.email),
    fromEmail: sender.email,
    fromName: sender.displayName,
    toEmail: recipient.email,
    toName: recipient.displayName,
    text: cleanText || "",
    audioUrl: audioUrl || null,
    audioDuration: audioDuration || null,
    edited: !!edited,
    deleted: !!deleted,
    reactions: {}, // emoji -> [emails]
    status: "sent", // sent | delivered | seen
    createdAt: Date.now(),
    deliveredAt: null,
    seenAt: null,
  };

  // store in-memory for fallback
  messages.push(message);

  if (messagesCollection) {
    messagesCollection.insertOne(message).catch(console.error);
  }

  // increment unread counter for recipient
  try {
    const recip = users.get(recipient.email);
    if (recip) {
      recip.unread = recip.unread || {};
      recip.unread[sender.email] = (recip.unread[sender.email] || 0) + 1;
      // persist recipient unread counts
      saveUserToDb(recip).catch(() => {});
      // notify clients that user lists/unread changed
      broadcastUsersUpdate();
    }
  } catch (err) {
    // ignore
  }

  return message;
}

async function handleRegisterRequest(req, res) {
  try {
    const body = await readBody(req);
    const email = normalizeEmail(body.email);
    console.log('[OTP REQUEST] email=', email);
      console.log("RAW EMAIL:", body.email);
      console.log("NORMALIZED EMAIL:", email);
      console.log("typeof isValidEmail =", typeof isValidEmail);

    const emailValid = (typeof isValidEmail === 'function')
      ? isValidEmail(email)
      : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254);
    if (!emailValid) {
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
  // Send the email asynchronously; don't block the request on delivery latency.

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
} catch (err) {
  console.error("REGISTER ERROR:", err);
  console.error("REGISTER STACK:", err?.stack);

  return sendJson(res, 500, {
    error: err?.message || "Internal server error"
  });
}
}
async function handleVerifyOtp(req, res) {
  const body = await readBody(req);
  const email = normalizeEmail(body.email);
  const otp = String(body.otp || "").trim();
  console.log('[OTP VERIFY] email=', email, 'otp=', otp);
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
  console.log('[OTP VERIFY] success, verificationToken=', verificationToken);

  return sendJson(res, 200, { verificationToken });
}

// Password reset: send OTP to user's email without requiring current password
async function handlePasswordSendOtp(req, res) {
  const session = getSession(req);
  const body = await readBody(req);
  const email = normalizeEmail(body.email || (session && session.user && session.user.email));

  if (!email) {
    return sendJson(res, 400, { error: "Please provide your email address." });
  }

  let user = users.get(email);
  if (!user && usersCollection) {
    try { user = await usersCollection.findOne({ email }); } catch (e) {}
  }

  if (!user) {
    return sendJson(res, 404, { error: "No account found with this email address." });
  }

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

  let user = users.get(verified.email);
  if (!user && usersCollection) {
    try { user = await usersCollection.findOne({ email: verified.email }); } catch (e) {}
  }
  if (!user) {
    verifiedRegistrations.delete(verificationToken);
    return sendJson(res, 404, { error: "User not found." });
  }

  const passwordData = hashPassword(password);
  user.passwordHash = passwordData.hash;
  user.passwordSalt = passwordData.salt;
  users.set(verified.email, user);
  saveUserToDb(user).catch(() => {});
  verifiedRegistrations.delete(verificationToken);

  return sendJson(res, 200, { ok: true });
}

async function handleCompleteRegistration(req, res) {
  const body = await readBody(req);
  const verificationToken = String(body.verificationToken || "");
  const password = String(body.password || "");
  console.log('[REGISTER COMPLETE] token=', verificationToken);
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
    bio: "",
    profilePicture: null,
    theme: "light",
    joinedAt: Date.now(),
    lastSeen: Date.now(),
  });
  // persist new user
  saveUserToDb(users.get(verified.email)).catch(() => {});
  verifiedRegistrations.delete(verificationToken);
  console.log('[REGISTER COMPLETE] user created=', verified.email);

  return sendJson(res, 201, { ok: true, email: verified.email });
}

async function handleLogin(req, res) {
  const body = await readBody(req);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  console.log('[LOGIN ATTEMPT] email=', email);
  const user = users.get(email);

  if (!user || !verifyPasswordWithFallback(password, user)) {
    return sendJson(res, 401, { error: "Invalid email or password." });
  }

  user.lastSeen = Date.now();
  // persist updated lastSeen
  saveUserToDb(user).catch(() => {});
  console.log('[LOGIN SUCCESS] email=', user.email);
  return sendJson(res, 200, {
    token: createJwt(user),
    email: user.email,
    displayName: user.displayName,
    profilePicture: user.profilePicture || null,
  });
}

// Verify Google ID token and sign in or create account
async function handleGoogleAuth(req, res) {
  try {
    const body = await readBody(req);
    const idToken = String(body.idToken || "");
    if (!idToken) return sendJson(res, 400, { error: "Missing idToken." });

    const ticket = await googleClient.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = normalizeEmail(payload.email || payload.email_verified && payload.email);
    if (!email) return sendJson(res, 400, { error: "Could not verify Google account email." });

    let user = users.get(email);
    if (!user) {
      // create new user record for Google user
      user = {
        email,
        displayName: (payload.name && String(payload.name).slice(0, 60)) || getDisplayName(email),
        authProvider: "google",
        googleId: payload.sub,
        profilePicture: payload.picture || null,
        bio: "",
        theme: "light",
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      };
      users.set(email, user);
      saveUserToDb(user).catch(() => {});
    } else {
      // update google fields if missing
      if (!user.profilePicture && payload.picture) user.profilePicture = payload.picture;
      if (!user.googleId && payload.sub) user.googleId = payload.sub;
      // do not overwrite passwordHash or authProvider for existing local accounts
      saveUserToDb(user).catch(() => {});
    }

    const token = createJwt(user);
    return sendJson(res, 200, { token, email: user.email, displayName: user.displayName, profilePicture: user.profilePicture || null });
  } catch (err) {
    console.error("Google auth error:", err && err.message ? err.message : err);
    return sendJson(res, 400, { error: "Failed to verify Google token." });
  }
}

async function handleApi(req, res) {
  if (req.method === "POST" && (req.url === "/api/register/request-otp" || req.url === "/api/send-otp")) {
    return handleRegisterRequest(req, res);
  }

  if (req.method === "POST" && (req.url === "/api/register/verify-otp" || req.url === "/api/verify-otp")) {
    return handleVerifyOtp(req, res);
  }

  if (req.method === "POST" && (req.url === "/api/register/complete" || req.url === "/api/register-complete")) {
    return handleCompleteRegistration(req, res);
  }

  if (req.method === "POST" && req.url === "/api/login") {
    return handleLogin(req, res);
  }

  if (req.method === "POST" && req.url === "/api/auth/google") {
    return handleGoogleAuth(req, res);
  }

  if (req.method === "GET" && req.url === "/api/config") {
    return sendJson(res, 200, { googleClientId: process.env.GOOGLE_CLIENT_ID || "" });
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
      profilePicture: session.user.profilePicture || null,
      authProvider: session.user.authProvider || "local",
      bio: session.user.bio || "",
      theme: session.user.theme || "light",
      wallpaper: session.user.wallpaper || "default",
      joinedAt: session.user.joinedAt || Date.now(),
      lastSeen: session.user.lastSeen || Date.now(),
    });
  }

  if (req.method === "POST" && req.url === "/api/me/update") {
    // update current user's profile
    const body = await readBody(req);
    const displayName = String((body.displayName || "")).trim().slice(0, 60);
    const bio = String((body.bio || "")).trim().slice(0, 500);
    const theme = (body.theme === "dark" || body.theme === "system") ? body.theme : "light";
    const wallpaper = String(body.wallpaper || "").trim().slice(0, 30) || "default";

    if (!displayName) {
      return sendJson(res, 400, { error: "Display name is required." });
    }

    session.user.displayName = displayName;
    session.user.bio = bio;
    if (body.profilePicture !== undefined) {
      session.user.profilePicture = body.profilePicture ? String(body.profilePicture).trim().slice(0, 1000) : null;
    }
    session.user.theme = theme;
    session.user.wallpaper = wallpaper;
    // optional notifications preferences
    if (body.notifications && typeof body.notifications === 'object') {
      session.user.notifications = {
        email: !!body.notifications.email,
        push: !!body.notifications.push,
        sound: !!body.notifications.sound,
      };
    }
    // persist
    saveUserToDb(session.user).catch(() => {});
    broadcastUsersUpdate();

    // issue a new token so clients can keep displayName in JWT
    const token = createJwt(session.user);
    return sendJson(res, 200, { ok: true, token, email: session.user.email, displayName: session.user.displayName, profilePicture: session.user.profilePicture || null, bio: session.user.bio || "", theme: session.user.theme || "light", wallpaper: session.user.wallpaper || "default" });
  }

  // Upload profile photo (base64 JSON payload)
  if (req.method === 'POST' && req.url === '/api/me/photo') {
    try {
      const body = await readBody(req);
      const imageBase64 = body.imageBase64;
      const imageType = String(body.imageType || 'image/png');
      if (!imageBase64) return sendJson(res, 400, { error: 'Missing image data' });
      // limit size ~5MB
      if (imageBase64.length > 6_000_000) return sendJson(res, 400, { error: 'Image too large' });

      const uploadsDir = path.resolve(FRONTEND_DIR, 'uploads');
      try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) {}
      const ext = imageType.includes('png') ? '.png' : imageType.includes('jpeg') || imageType.includes('jpg') ? '.jpg' : '.webp';
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`;
      const filepath = path.join(uploadsDir, filename);
      try {
        fs.writeFileSync(filepath, Buffer.from(imageBase64, 'base64'));
      } catch (err) {
        console.error('Failed to save profile image', err);
        return sendJson(res, 500, { error: 'Failed to save image' });
      }

      const imageUrl = `/uploads/${filename}`;
      session.user.profilePicture = imageUrl;
      saveUserToDb(session.user).catch(() => {});
      broadcastUsersUpdate();
      const token = createJwt(session.user);
      return sendJson(res, 200, { ok: true, token, profilePicture: session.user.profilePicture, displayName: session.user.displayName, email: session.user.email });
    } catch (err) {
      return sendJson(res, 500, { error: 'Upload failed' });
    }
  }

  // Profile statistics: total chats, total messages, shared media count
  if (req.method === 'GET' && req.url === '/api/me/stats') {
    try {
      let totalMessages = 0;
      let totalChats = 0;
      let sharedMediaCount = 0;
      if (messagesCollection) {
        const pipeline = [
          { $match: { $or: [{ fromEmail: session.email }, { toEmail: session.email }] } },
          { $project: { other: { $cond: [{ $eq: ["$fromEmail", session.email] }, "$toEmail", "$fromEmail"] }, hasMedia: { $cond: [{ $or: [{ $ifNull: ["$audioUrl", false] }, { $ifNull: ["$attachments", false] }] }, 1, 0] } } },
          { $group: { _id: null, totalMessages: { $sum: 1 }, sharedMediaCount: { $sum: "$hasMedia" }, chats: { $addToSet: "$other" } } },
          { $project: { totalMessages: 1, sharedMediaCount: 1, totalChats: { $size: "$chats" } } }
        ];
        const agg = await messagesCollection.aggregate(pipeline).toArray();
        if (agg && agg[0]) {
          totalMessages = agg[0].totalMessages || 0;
          sharedMediaCount = agg[0].sharedMediaCount || 0;
          totalChats = agg[0].totalChats || 0;
        }
      } else {
        // fallback to in-memory
        const set = new Set();
        for (const m of messages) {
          if (m.fromEmail === session.email || m.toEmail === session.email) {
            const other = m.fromEmail === session.email ? m.toEmail : m.fromEmail;
            set.add(other);
            totalMessages++;
            if (m.audioUrl || m.attachments) sharedMediaCount++;
          }
        }
        totalChats = set.size;
      }

      return sendJson(res, 200, { totalChats, totalMessages, sharedMediaCount });
    } catch (err) {
      console.error('Stats error', err);
      return sendJson(res, 500, { error: 'Could not compute stats' });
    }
  }

  // Search users by query (email or displayName). Returns at most 20 results.
  if (req.method === "GET" && req.url.startsWith("/api/users/search")) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const q = String(url.searchParams.get("q") || "").trim();

      // If query is empty, return empty results (clients should only call when user types)
      if (!q) return sendJson(res, 200, { users: [] });

      // build case-insensitive regex safely
      const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(esc, "i");

      let found = [];
      if (usersCollection) {
        try {
          found = await usersCollection
            .find({
              $and: [
                { email: { $ne: session.email } },
                { $or: [{ email: regex }, { displayName: regex }] },
              ],
            })
            .limit(20)
            .toArray();
        } catch (e) {
          found = [];
        }
      } else {
        // fallback to in-memory map
        found = [...users.values()].filter((u) => {
          if (!u || !u.email) return false;
          if (u.email === session.email) return false;
          const dn = String(u.displayName || "");
          return regex.test(u.email) || regex.test(dn);
        }).slice(0, 20);
      }

      const out = (found || []).map((u) => ({
        email: u.email,
        displayName: u.displayName || getDisplayName(u.email),
        profilePicture: u.profilePicture || null,
        online: activeUsers.has(u.email),
        lastSeen: u.lastSeen || Date.now(),
        unreadCount: session.user.unread?.[u.email] || 0,
      }));

      return sendJson(res, 200, { users: out });
    } catch (err) {
      return sendJson(res, 500, { error: "Search failed." });
    }
  }

  // Recent chats: return users who have exchanged messages with the current user
  if (req.method === "GET" && req.url === "/api/recent-chats") {
    try {
      // If messagesCollection available, use aggregation for efficiency
      let recent = [];
      if (messagesCollection) {
        const pipeline = [
          { $match: { $or: [{ fromEmail: session.email }, { toEmail: session.email }] } },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: { $cond: [{ $eq: ["$fromEmail", session.email] }, "$toEmail", "$fromEmail"] },
              lastMessage: { $first: "$$ROOT" },
            },
          },
          { $sort: { "lastMessage.createdAt": -1 } },
          { $limit: 50 },
        ];

        const agg = await messagesCollection.aggregate(pipeline).toArray();
        for (const row of agg) {
          const other = row._id;
          let u = null;
          if (usersCollection) {
            try { u = await usersCollection.findOne({ email: other }); } catch (e) { u = null; }
          }
          if (!u) u = users.get(other) || { email: other, displayName: getDisplayName(other), profilePicture: null, lastSeen: Date.now() };

          recent.push({
            email: other,
            displayName: u.displayName || getDisplayName(other),
            profilePicture: u.profilePicture || null,
            online: activeUsers.has(other),
            unreadCount: session.user.unread?.[other] || 0,
            lastMessageText: row.lastMessage && row.lastMessage.text ? row.lastMessage.text : "",
            lastMessageTime: row.lastMessage && row.lastMessage.createdAt ? row.lastMessage.createdAt : 0,
          });
        }
      } else {
        // fallback to in-memory messages array
        const map = new Map();
        const sorted = messages.slice().sort((a, b) => b.createdAt - a.createdAt);
        for (const m of sorted) {
          const other = m.fromEmail === session.email ? m.toEmail : (m.toEmail === session.email ? m.fromEmail : null);
          if (!other) continue;
          if (!map.has(other)) map.set(other, m);
        }
        for (const [other, lastMessage] of map.entries()) {
          const u = users.get(other) || { email: other, displayName: getDisplayName(other), profilePicture: null, lastSeen: Date.now() };
          recent.push({
            email: other,
            displayName: u.displayName || getDisplayName(other),
            profilePicture: u.profilePicture || null,
            online: activeUsers.has(other),
            unreadCount: session.user.unread?.[other] || 0,
            lastMessageText: lastMessage.text || "",
            lastMessageTime: lastMessage.createdAt || 0,
          });
        }
        // sort by lastMessageTime desc
        recent.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
      }

      return sendJson(res, 200, { recentChats: recent });
    } catch (err) {
      console.error('Recent chats error', err);
      return sendJson(res, 500, { error: 'Could not fetch recent chats' });
    }
  }

  // Deprecated: /api/users no longer returns all users for privacy reasons.
  if (req.method === "GET" && req.url === "/api/users") {
    return sendJson(res, 403, { error: "Endpoint removed. Use /api/recent-chats and /api/users/search?q=" });
  }

  if (req.method === "POST" && req.url === "/api/unread/reset") {
    const body = await readBody(req);
    const withEmail = normalizeEmail(body.withEmail || "");
    if (!withEmail) return sendJson(res, 400, { error: "withEmail is required" });
    // reset unread counter for session.user for messages from withEmail
    session.user.unread = session.user.unread || {};
    session.user.unread[withEmail] = 0;
    saveUserToDb(session.user).catch(() => {});
    // notify others that counts changed
    broadcastUsersUpdate();
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && req.url.startsWith("/api/messages")) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const withEmail = normalizeEmail(url.searchParams.get("with"));
    const after = Number(url.searchParams.get("after") || 0);

    if (!withEmail || !users.has(withEmail)) {
      return sendJson(res, 404, { error: "User not found." });
    }

    const key = conversationKey(session.email, withEmail);
    const chat = await messagesCollection
      .find({ chat: key })
      .sort({ createdAt: 1 })
      .toArray();
    return sendJson(res, 200, { messages: chat });
  }

  if (req.method === 'POST' && req.url === '/api/voice/upload') {
    try {
      const body = await readBody(req);
      const to = normalizeEmail(body.to || '');
      const audioBase64 = body.audioBase64;
      const audioType = String(body.audioType || 'audio/webm');
      const duration = Number(body.duration || 0);

      if (!to || !users.has(to)) return sendJson(res, 400, { error: 'Invalid recipient' });
      if (!audioBase64) return sendJson(res, 400, { error: 'Missing audio data' });

      const uploadsDir = path.resolve(FRONTEND_DIR, 'uploads');
      try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) {}
      const ext = audioType.includes('ogg') ? '.ogg' : audioType.includes('wav') ? '.wav' : '.webm';
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2,8)}${ext}`;
      const filepath = path.join(uploadsDir, filename);
      try {
        fs.writeFileSync(filepath, Buffer.from(audioBase64, 'base64'));
      } catch (err) {
        console.error('Failed to save audio', err);
        return sendJson(res, 500, { error: 'Failed to save audio' });
      }

      const audioUrl = `/uploads/${filename}`;
      const message = createMessage({ sender: session.user, toEmail: to, text: '', audioUrl, audioDuration: duration });
      io.to(`user:${message.fromEmail}`).to(`user:${message.toEmail}`).emit('private:message', message);
      return sendJson(res, 201, { message });
    } catch (err) {
      return sendJson(res, 500, { error: 'Upload failed' });
    }
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
      // Fallback to index.html for SPA routes or non-file paths
      const indexPath = path.resolve(FRONTEND_DIR, "index.html");
      return fs.readFile(indexPath, (err2, indexContent) => {
        if (err2) {
          res.writeHead(404);
          return res.end("Not found");
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(indexContent);
      });
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".webm": "audio/webm",
      ".ogg": "audio/ogg",
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
    };
    const type = mimeTypes[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {

  const origin = req.headers.origin;

  if (allowedOrigins.includes("*") || (origin && allowedOrigins.includes(origin))) {
    // If wildcard is allowed, echo the request origin or use '*'
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.url.startsWith("/api/")) {
    console.log(`[${new Date().toISOString()}] PID ${process.pid} incoming ${req.method} ${req.url}`);
    handleApi(req, res).catch((error) =>
      sendJson(res, 400, { error: error.message })
    );
    return;
  }

  serveStatic(req, res);
});

const io = new Server(server, {
  cors: {
    origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

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
        audioUrl: payload && payload.audioUrl || null,
        audioDuration: payload && payload.audioDuration || null,
      });

      io.to(`user:${message.fromEmail}`)
        .to(`user:${message.toEmail}`)
        .emit("private:message", message);
      if (typeof callback === "function") callback({ ok: true, message });
    } catch (error) {
      if (typeof callback === "function") callback({ ok: false, error: error.message });
    }
  });

  // Typing indicator: debounce on server to avoid floods
  let typingTimeouts = {};
  socket.on("typing:start", (payload) => {
    try {
      const toEmail = normalizeEmail(payload && payload.to);
      if (!toEmail) return;
      io.to(`user:${toEmail}`).emit("typing:start", { from: user.email, to: toEmail, text: `${user.displayName} is typing...` });
      // clear previous timeout if exists
      if (typingTimeouts[user.email]) clearTimeout(typingTimeouts[user.email]);
      typingTimeouts[user.email] = setTimeout(() => {
        io.to(`user:${toEmail}`).emit("typing:stop", { from: user.email, to: toEmail });
        delete typingTimeouts[user.email];
      }, 2000);
    } catch (err) {}
  });

  socket.on("typing:stop", (payload) => {
    try {
      const toEmail = normalizeEmail(payload && payload.to);
      if (!toEmail) return;
      if (typingTimeouts[user.email]) {
        clearTimeout(typingTimeouts[user.email]);
        delete typingTimeouts[user.email];
      }
      io.to(`user:${toEmail}`).emit("typing:stop", { from: user.email, to: toEmail });
    } catch (err) {}
  });

  // Message delivered acknowledgement (client should emit when they receive via socket)
  socket.on("message:delivered", async (payload) => {
    try {
      const msgId = payload && payload.id;
      if (!msgId) return;
      // update message status to delivered and set deliveredAt
      if (messagesCollection) {
        await messagesCollection.updateOne({ id: msgId }, { $set: { status: 'delivered', deliveredAt: Date.now() } }).catch(() => {});
      }
      // update in-memory
      const m = messages.find((x) => x.id === msgId);
      if (m) { m.status = 'delivered'; m.deliveredAt = Date.now(); }
      // notify sender if online
      if (m && m.fromEmail) io.to(`user:${m.fromEmail}`).emit('message:delivered', { id: msgId, deliveredAt: Date.now() });
    } catch (err) {}
  });

  // Message seen: mark messages in DB as seen when recipient opens conversation
  socket.on("message:seen", async (payload) => {
    try {
      const ids = payload && payload.ids; // array of message ids
      if (!Array.isArray(ids) || !ids.length) return;
      const now = Date.now();
      if (messagesCollection) {
        await messagesCollection.updateMany({ id: { $in: ids } }, { $set: { status: 'seen', seenAt: now } }).catch(() => {});
      }
      // update in-memory
      ids.forEach((id) => {
        const mm = messages.find((x) => x.id === id);
        if (mm) { mm.status = 'seen'; mm.seenAt = now; }
      });
      // notify senders
      ids.forEach((id) => {
        const mm = messages.find((x) => x.id === id);
        if (mm && mm.fromEmail) io.to(`user:${mm.fromEmail}`).emit('message:seen', { id, seenAt: now });
      });
    } catch (err) {}
  });

  // Message reaction toggle and broadcast
  socket.on("message:reaction", async (payload) => {
    try {
      const { id, reaction } = payload || {};
      if (!id || !reaction) return;
      const reactor = user.email;

      const updateReactionsObj = (currentMap) => {
        const resMap = Object.assign({}, currentMap || {});
        const wasReactedWithSame = Array.isArray(resMap[reaction]) && resMap[reaction].includes(reactor);
        
        // Remove reactor from all existing reaction arrays
        for (const k of Object.keys(resMap)) {
          if (Array.isArray(resMap[k])) {
            resMap[k] = resMap[k].filter(e => e !== reactor);
            if (resMap[k].length === 0) delete resMap[k];
          }
        }
        
        // Toggle: if it wasn't already reacted with this exact emoji, add it
        if (!wasReactedWithSame) {
          if (!resMap[reaction]) resMap[reaction] = [];
          resMap[reaction].push(reactor);
        }
        return resMap;
      };

      let updated = {};
      let targetMessage = null;

      if (messagesCollection) {
        const msg = await messagesCollection.findOne({ id });
        if (msg) {
          targetMessage = msg;
          updated = updateReactionsObj(msg.reactions || {});
          await messagesCollection.updateOne({ id }, { $set: { reactions: updated } });
          const mm = messages.find((x) => x.id === id);
          if (mm) mm.reactions = updated;
        }
      } else {
        const mm = messages.find((x) => x.id === id);
        if (mm) {
          targetMessage = mm;
          updated = updateReactionsObj(mm.reactions || {});
          mm.reactions = updated;
        }
      }

      if (targetMessage) {
        io.to(`user:${targetMessage.fromEmail}`).to(`user:${targetMessage.toEmail}`).emit('message:reaction', { id, reactions: updated });
      } else {
        io.emit('message:reaction', { id, reactions: updated });
      }
    } catch (err) {
      console.error('Reaction error:', err);
    }
  });

  // Voice upload notification (backend handles storing file; client emits when upload done)
  socket.on('voice:uploaded', (payload) => {
    try {
      const { id, audioUrl, audioDuration } = payload || {};
      if (!id) return;
      // update message if exists in memory
      const mm = messages.find((x) => x.id === id);
      if (mm) { mm.audioUrl = audioUrl; mm.audioDuration = audioDuration; }
      if (messagesCollection) {
        messagesCollection.updateOne({ id }, { $set: { audioUrl, audioDuration } }).catch(() => {});
      }
      io.emit('voice:uploaded', { id, audioUrl, audioDuration });
    } catch (err) {}
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
