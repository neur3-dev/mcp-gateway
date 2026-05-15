# Security Policy

## Reporting

Do not open public issues for suspected vulnerabilities that include exploit details, credentials, or sensitive deployment information.

Until a private reporting channel is published, use GitHub's private vulnerability reporting feature when available for this repository.

## Current Security Posture

This project is an alpha implementation. Before production use, review:

- downstream MCP server trust boundaries
- API-key issuance and rotation procedures
- RBAC policy ownership
- PostgreSQL privileges and backups
- TLS termination and network exposure
- audit retention and access controls

## Handling Secrets

- Never commit real credentials.
- Prefer environment variables or encrypted `enc:` config values.
- Treat `config.example.yaml` and `docker/docker-compose.yml` as local examples, not production defaults.
