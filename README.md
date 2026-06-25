# BuddyChat 💬

A modern real-time one-to-one messaging platform built with Node.js, Socket.IO, MongoDB Atlas, and Google OAuth.

BuddyChat allows users to securely register using Email OTP verification or Google Sign-In, manage profiles, and communicate through private real-time conversations.

---

## 🚀 Features

### Authentication

* Email OTP Verification
* Secure Password-Based Login
* Google OAuth Sign-In
* JWT Authentication
* Session Persistence

### Messaging

* Real-Time Private Messaging
* Online / Offline Status
* Last Seen Tracking
* Unread Message Counters
* Recent Chats
* User Search
* Message History Persistence

### User Profiles

* Profile Picture Upload
* Custom Display Name
* Bio / About Section
* Joined Date
* Last Seen Information
* Profile Settings

### Database

* MongoDB Atlas Integration
* Persistent User Accounts
* Persistent Messages
* Persistent Profile Data

---

## 🛠️ Tech Stack

### Frontend

* HTML5
* CSS3
* Vanilla JavaScript

### Backend

* Node.js
* Socket.IO
* JWT Authentication
* Google OAuth

### Database

* MongoDB Atlas

### Email Service

* Resend API

### Deployment

* Frontend: Vercel
* Backend: Render

---

## 📂 Project Structure

```text
BuddyChat/
│
├── backend/
│   ├── server.js
│   ├── routes/
│   ├── controllers/
│   └── database/
│
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
│
├── .env
├── package.json
└── README.md
```

---

## ⚙️ Environment Variables

Create a `.env` file in the project root.

```env
PORT=3000

JWT_SECRET=your_jwt_secret

RESEND_API_KEY=your_resend_api_key

GOOGLE_CLIENT_ID=your_google_client_id

MONGODB_URI=your_mongodb_connection_string

MONGODB_DB=chatbot
```

---

## 📦 Installation

### Clone Repository

```bash
git clone https://github.com/avinashreddy987/Buddy-chat.git
cd Buddy-chat
```

### Install Dependencies

```bash
npm install
```

### Start Development Server

```bash
npm start
```

Open:

```text
http://localhost:3000
```

---

## 🔑 Google Sign-In Setup

1. Open Google Cloud Console.
2. Create a new project.
3. Configure OAuth Consent Screen.
4. Create OAuth 2.0 Client ID.
5. Add:

```text
http://localhost:3000
```

to Authorized JavaScript Origins.

6. Copy the Client ID into:

```env
GOOGLE_CLIENT_ID=YOUR_CLIENT_ID
```

---

## 📧 OTP Email Setup

BuddyChat uses Resend for Email OTP delivery.

Add your API key:

```env
RESEND_API_KEY=YOUR_API_KEY
```

Restart the server after updating environment variables.

---

## 🗄️ MongoDB Atlas Setup

1. Create a MongoDB Atlas cluster.
2. Create a database user.
3. Obtain the connection string.
4. Add it to:

```env
MONGODB_URI=YOUR_CONNECTION_STRING
```

Example:

```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
```

---

## 🎯 Current Features

* Email OTP Registration
* Google Authentication
* Real-Time Messaging
* User Search
* Recent Chats
* Online Presence
* Profile Management
* MongoDB Persistence
* Responsive UI

---

## 🔮 Planned Features

* Message Reactions
* Voice Messages
* Camera Upload
* File Sharing
* Read Receipts
* Typing Indicators
* Delete for Everyone
* Media Gallery

---

## 👨‍💻 Author

Avinash Reddy

GitHub:
https://github.com/avinashreddy987

Project Repository:
https://github.com/avinashreddy987/Buddy-chat

Live Demo:
https://buddychat-self.vercel.app/

---

## 📄 License

This project is created for learning, portfolio, and demonstration purposes.
