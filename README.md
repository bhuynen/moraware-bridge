# Canadian Countertops — Moraware Bridge Server

Connects your client portal to Moraware's API.

## Environment Variables (set in Railway)

| Variable | Example | Description |
|---|---|---|
| MORAWARE_URL | https://canadiancountertops.moraware.net/api.aspx | Your Moraware API URL |
| MORAWARE_USER | braydin@canadiancountertops.ca | Your Moraware username |
| MORAWARE_PASS | yourpassword | Your Moraware password |
| PORT | 3000 | Auto-set by Railway |

## Endpoints

- GET /health — check server is running
- GET /jobs — all jobs from Moraware
- GET /jobs/customer@email.com — jobs for a specific customer
 
