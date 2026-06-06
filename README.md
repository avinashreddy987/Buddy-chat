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
 - OTP email is sent with Nodemailer. By default (when SMTP is not configured) the server will create an Ethereal test account and log a preview URL instead of delivering to a real inbox. To send real emails, copy `.env.example` to `.env` and fill the `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` values, then restart the server.
- Login uses email and password, then receives a JWT.
- Private chat messages use Socket.IO.
- To send email, create `.env` from `.env.example` and set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`.
 - After creating `.env`, restart the server so environment variables are picked up.
 - Quick OTP test (replace the email):

```bash
curl -X POST http://localhost:3000/api/register/request-otp \
	-H "Content-Type: application/json" \
	-d '{"email":"you@example.com"}'
```

If SMTP is configured correctly you should receive the OTP in the provided address. If not configured, the server console will show an "Ethereal preview URL:" link you can open to view the email.
- This is a beginner/demo app, so accounts, sessions, and messages are stored in memory.
- Restarting the server clears all users, sessions, and messages.
- For a real app, add a database, rate limiting, password reset, HTTPS, and persistent message storage.
