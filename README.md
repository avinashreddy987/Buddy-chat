# One-to-One Chat

A small login-and-chat demo. Users create an account with email OTP verification, log in with email and password, then send private one-to-one messages over Socket.IO.

## Run

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000
```

To test two people, create two accounts in two browser tabs or two different browsers and log in with different emails.

## Notes

- `backend/` contains the Node.js server and API routes.
- `frontend/` contains the browser HTML, CSS, and JavaScript.
- Account creation uses email OTP verification, then password creation.
 - Account creation uses email OTP verification, then password creation.
 - OTP email is sent with Resend. Set `RESEND_API_KEY` in `.env` (copy from `.env.example`) and restart the server.
- Login uses email and password, then receives a JWT.
- Private chat messages use Socket.IO.
 - To send email, create `.env` from `.env.example`, set `RESEND_API_KEY`, and restart the server so environment variables are picked up.
 - Quick OTP test (replace the email):

```bash
curl -X POST http://localhost:3000/api/register/request-otp \
	-H "Content-Type: application/json" \
	-d '{"email":"you@example.com"}'
```

If SMTP is configured correctly you should receive the OTP in the provided address. If not configured, the server console will show an "Ethereal preview URL:" link you can open to view the email.
If you have `RESEND_API_KEY` set the app will send OTPs via Resend. Check the server console for logs such as:

- "Sending OTP via Resend..."
- "OTP email sent successfully"
- "Resend Error: ..."
- This is a beginner/demo app, so accounts, sessions, and messages are stored in memory.
- Restarting the server clears all users, sessions, and messages.
- For a real app, add a database, rate limiting, password reset, HTTPS, and persistent message storage.

## Google Sign-In (OAuth 2.0)

This project now supports signing in with Google as an alternative to the existing Email/OTP + Password flow. Both methods authenticate users into the same application and persist Google users in MongoDB.

Steps to enable Google Sign-In:

1. Create a project in Google Cloud Console and configure OAuth consent.
2. Create an OAuth 2.0 Client ID for a Web application.
	 - Add `http://localhost:3000` to the Authorized JavaScript origins.
	 - Add `http://localhost:3000` to the Authorized redirect URIs (not strictly required for the client-side flow but safe to include).
3. Copy the `Client ID` value.

Environment variables:

- `GOOGLE_CLIENT_ID` — the OAuth 2.0 Client ID from Google Cloud.
- `MONGODB_URI`, `MONGODB_DB` — existing MongoDB settings (if using MongoDB persistence).

Backend changes:

- Adds the `google-auth-library` package to verify ID tokens server-side.
- New endpoint: `POST /api/auth/google` — accepts `{ idToken }`, verifies the token, creates or updates a user record, and returns a JWT and profile info.
- New endpoint: `GET /api/config` — returns `{ googleClientId }` for the frontend.

Frontend changes:

- Adds a "Continue with Google" button below the existing login form (keeps the current login flow intact).
- The Google Identity Services button opens the Google account picker and returns an ID token to the backend for verification.
- Google users' profile pictures are displayed in the chat UI.

Database schema notes:

The MongoDB `users` documents now may include the following keys:

{
	authProvider: "google" | "local",
	googleId: string | null,
	email: string,
	displayName: string,
	profilePicture: string | null,
	joinedAt: number,
	lastSeen: number,
	// local-only fields remain: passwordHash, passwordSalt
}

Install new dependency and restart:

```bash
npm install
npm start
```

If you want me to also add a `.env.example` entry or automated setup script for Google credentials, I can add that next.
