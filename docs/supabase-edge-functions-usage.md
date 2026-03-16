# Supabase Edge Functions Usage Guide

This guide explains how to manage, deploy, and troubleshoot Supabase Edge Functions for the Rhythm Visualizer project.

## Deployment

Every time you modify the backend code (e.g., `supabase/functions/ai-assistant/index.ts`), you must redeploy it for the changes to take effect. The Supabase CLI handles bundling (repacking) automatically.

To deploy the AI Assistant:
```bash
supabase functions deploy ai-assistant --no-verify-jwt
```

> [!IMPORTANT]
> The `--no-verify-jwt` flag is required because the AI Assistant is currently accessible to public users without requiring them to be signed in.

## Troubleshooting & Local Development

### Local Serving
To test your functions locally before deploying to the cloud:
```bash
supabase functions serve ai-assistant
```
This will run the function on your machine, typically at `http://localhost:54321`.

### Viewing Logs
To see real-time logs from your deployed function:
```bash
supabase functions logs ai-assistant
```

## Secret Management

Sensitive information like API keys should never be hardcoded in the function. Use Supabase Secrets instead.

### Setting a Secret
To set or update your Gemini API key:
```bash
supabase secrets set GEMINI_API_KEY=your_actual_api_key_here
```

### Listing Secrets
To see which secrets are currently set (values are hidden for security):
```bash
supabase secrets list
```

## Project Configuration

If you are setting up the CLI on a new machine, ensure you are linked to the correct project:
```bash
supabase login
supabase link --project-ref ycdlqkaymkgpbpgtqubs
```
