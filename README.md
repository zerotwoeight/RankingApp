# TOP//3

A party ranking game for shared-screen video calls. The host shares the big screen; everyone plays on their phone.

1. Host sets a prompt. Players join with the room code / QR (max 10).
2. Everyone secretly submits 3 entries (extras become honorable mentions).
3. Players flip their own cards onto the shared screen.
4. Everyone gets 6 tokens to spend however they like; the leaderboard reorders live.
5. Host closes voting and the top 3 hit the podium.

## Run it

Needs Node 18+. No packages to install.

Version: bump `version` in `package.json` for each iteration. It shows bottom-left on the host screen, at the bottom of the phone view, and in Settings. Open pages reload themselves when the server version changes.

```bash
npm start          # or: node server.js
```

- Host screen: http://localhost:3000 — open it in a browser and share that window on the call.
- Phones: http://<your-address>:3000/play (the lobby shows a QR code and room code).

## Playing over a video call

Phones need to reach the server over the internet, not just your Wi-Fi. Either:

- **Deploy** the `build` folder to any Node host (Render, Railway, Fly.io…): start command `npm start`; the app reads `PORT` from the environment. Note: rooms live in server memory, so a single instance is required.
- **Tunnel** your local server for the session, e.g. `cloudflared tunnel --url http://localhost:3000`, then open the host screen at the tunnel URL so the QR code points there.

## Files

- `server.js` — HTTP server, game rules, live updates (Server-Sent Events).
- `public/host.html`, `public/host.js` — shared host screen (lobby, card wall, live leaderboard, podium).
- `public/play.html`, `public/play.js` — phone client (join, submit, flip, tokens, results).
- `public/common.js`, `public/style.css` — shared helpers, 8-bit coin, retro arcade styling.

## Host controls

Click the phase tabs to jump between phases at any time. On the card wall, tap revealed cards to select them, then **Merge** duplicates, **Edit** or **Remove**. **Pause · Add player** goes back to reveal so latecomers can submit and flip; tokens are kept. Remove players from the lobby list. On the podium, **Tie · Move up** breaks ties.
