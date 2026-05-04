# Playback

Replay Claude Code sessions step-by-step — see what the user asked, what the agent reasoned, which tools ran, and what it produced.

![Playback UI](https://github.com/user-attachments/assets/e699049b-42cc-4a2d-9ef8-e3c81604949c)

## Architecture

```
Browser
  │
  ▼
CloudFront (HTTPS)
  ├── /*      → S3 (React app)
  └── /api/*  → ALB → ECS Fargate
                         ├── node-api  → DynamoDB (sessions)
                         └── summarizer → OpenAI API
```

## Run locally

```bash
npm install
npm start        # backend on :4000
cd client && npm run dev   # frontend on :5173
```

Drop any `.jsonl` from `~/.claude/projects/` onto the app to load a real session.

## AI summaries (optional)

```bash
cd summarizer
OPENAI_API_KEY=sk-... uvicorn main:app --port 8000
```
