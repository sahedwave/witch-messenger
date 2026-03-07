# Messenger MVP+

A Messenger-style chat app built with React, Express, Socket.io, and MongoDB.

## What it includes

- Registration, login, session restore, and logout-all-sessions
- One-to-one realtime chat with MongoDB history
- Contact search, pinned chats, muted chats, and blocked conversations
- Sent, delivered, seen, edited, and soft-deleted messages
- Emoji reactions and a simple emoji picker
- Image/file attachments
- In-app toast alerts, browser notifications, and sound alerts
- Online, away, offline, last-active, and multi-device presence
- Profile picture upload with center-crop before upload
- Infinite-scroll chat history
- Dark mode and keyboard shortcuts
- Basic auth/message rate limiting, Helmet headers, audit logging, and stricter validation
- Demo user seed script
- Docker, Render, Railway, and Vercel setup files
- Integration tests for auth, message lifecycle, and sockets

## Project structure

```text
messenger-mvp/
├── client/
│   ├── Dockerfile
│   ├── vercel.json
│   ├── package.json
│   └── src/
│       ├── App.jsx
│       ├── api.js
│       ├── index.css
│       └── components/
│           ├── AuthForm.jsx
│           ├── Avatar.jsx
│           ├── ConversationPane.jsx
│           ├── Sidebar.jsx
│           └── Toasts.jsx
├── server/
│   ├── Dockerfile
│   ├── package.json
│   ├── scripts/
│   │   └── seedDemoUsers.js
│   ├── src/
│   │   ├── app.js
│   │   ├── server.js
│   │   ├── middleware/
│   │   ├── models/
│   │   ├── routes/
│   │   └── utils/
│   └── tests/
│       └── app.test.js
├── docker-compose.yml
├── render.yaml
├── railway.json
├── server.env.example
└── client.env.example
```

## Local development

### 1. Configure env files

```bash
cd "/Users/VIP/Documents/New project/messenger-mvp"
cp server.env.example server/.env
cp client.env.example client/.env
```

### 2. Install dependencies

```bash
cd "/Users/VIP/Documents/New project/messenger-mvp/server"
npm install

cd "/Users/VIP/Documents/New project/messenger-mvp/client"
npm install
```

### 3. Start MongoDB

If you use Homebrew:

```bash
brew services start mongodb/brew/mongodb-community
```

Or use Docker just for MongoDB:

```bash
cd "/Users/VIP/Documents/New project/messenger-mvp"
docker compose up -d mongodb
```

### 4. Optional: seed demo users

```bash
cd "/Users/VIP/Documents/New project/messenger-mvp/server"
npm run seed:demo
```

Demo passwords:

- `alice@example.com` / `alice123`
- `bob@example.com` / `bob12345`
- `charlie@example.com` / `charlie123`

### 5. Start the backend

```bash
cd "/Users/VIP/Documents/New project/messenger-mvp/server"
npm run start
```

### 6. Start the frontend

```bash
cd "/Users/VIP/Documents/New project/messenger-mvp/client"
npm run dev -- --host 127.0.0.1
```

### 7. Open the app

- Frontend: [http://127.0.0.1:5173/](http://127.0.0.1:5173/)
- API: [http://localhost:5001](http://localhost:5001)

## Docker startup

To run MongoDB, the API, and the built frontend together:

```bash
cd "/Users/VIP/Documents/New project/messenger-mvp"
docker compose up --build
```

Then open [http://localhost:4173](http://localhost:4173).

## Tests

Run the backend integration tests:

```bash
cd "/Users/VIP/Documents/New project/messenger-mvp/server"
npm test
```

## Deployment files

- Render: [`render.yaml`](/Users/VIP/Documents/New project/messenger-mvp/render.yaml)
- Railway: [`railway.json`](/Users/VIP/Documents/New project/messenger-mvp/railway.json)
- Vercel client config: [`client/vercel.json`](/Users/VIP/Documents/New project/messenger-mvp/client/vercel.json)

## Environment values

`server/.env`

```env
PORT=5001
MONGODB_URI=mongodb://127.0.0.1:27017/messenger-mvp
JWT_SECRET=replace-with-a-long-random-secret
CLIENT_URL=http://localhost:5173,http://127.0.0.1:5173
BCRYPT_ROUNDS=12
```

`client/.env`

```env
VITE_API_URL=http://localhost:5001/api
VITE_SOCKET_URL=http://localhost:5001
```

## Keyboard shortcuts

- `Ctrl/Cmd + K`: focus contact search
- `Ctrl/Cmd + Shift + D`: toggle dark mode
- `Ctrl/Cmd + Shift + E`: toggle emoji picker
- `Esc`: close emoji picker, cancel edit, or go back to contacts on mobile
