# Playback

Simple session playback UI with swimlane view and tape-recorder controls.

## Run locally

```bash
cd /Users/mac/Desktop/playback-mvp
npm install
npm start
```

Open: `http://localhost:3000`

## Upload a session

```bash
node cli.js /path/to/session.jsonl
```

It prints a URL like:

```
http://localhost:3000/session/<session_id>
```

## Notes

- Sessions are stored in memory (TTL default: 3600s).
- Override TTL and limits with env vars:
  - `TTL_SECONDS=600`
  - `MAX_SESSIONS=50`
  - `JSON_LIMIT=25mb`
