# Playback

Session playback UI with a tape-deck view and swimlane timeline.

## Run locally

```bash
cd /Users/mac/Desktop/playback-mvp
npm install
npm start
```

Open: `http://localhost:3000`

## Upload a session

```bash
node /Users/mac/Desktop/playback-mvp/cli.js /path/to/session.jsonl
```

It prints a URL like:

```
http://localhost:3000/session/<session_id>
```

## Deploy to Render

This repo includes a `render.yaml` blueprint.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/suhaasteja/playback)

### Environment variables

- `TTL_SECONDS` (default: 3600)
- `MAX_SESSIONS` (default: 200)
- `JSON_LIMIT` (default: 25mb)
