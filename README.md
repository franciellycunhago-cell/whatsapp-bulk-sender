# WhatsApp Bulk Sender (Baileys), a local automation case study

A command-line tool that sends controlled, opt-in WhatsApp campaigns from the operator's own machine, using the WhatsApp Web linked-device protocol (Baileys) instead of the official API. It was built for a small-business campaign and ran in production with zero infrastructure cost.

> **Read this first.** Unofficial WhatsApp clients go against WhatsApp's Terms of Service and a number can be banned. This repository documents an engineering approach to sending *slowly, to people who opted in, with a working opt-out*. For production at scale, use the official WhatsApp Business Cloud API.

## What I built and why

The first version ran on a cloud VPS (Evolution API + n8n). Several numbers were restricted within hours, and the pattern pointed at the datacenter IP rather than the chips: a daily-used personal number failed too. I moved the sender to run locally on a residential connection. In the validation run, 10 of 10 messages were delivered with no errors.

## Features

- **Human-like pacing:** random delay between sends, batches with long pauses, a daily send window, simulated typing proportional to message length.
- **Warm-up quota per chip:** a configurable curve (for example 8/day for the first 3 days, rising to 70/day), counted per chip.
- **Message variation:** several copy versions rotated in blocks, `{Hi|Hello}` alternatives and `{{first_name}}` variables, `---` to split into two messages.
- **Opt-in required and automatic opt-out:** only contacts marked `optin=sim` are sent to. Replies such as "STOP" are detected, added to a global `optout.csv`, confirmed, and never queued again. Detection is conservative on purpose (a plain "no" is not an opt-out).
- **Safety stops:** checks the number exists on WhatsApp before sending, stops after N consecutive failures, resumes without re-sending to anyone already contacted, times out instead of waiting forever for a QR code.
- **Tooling:** base export (read-only), splitting a base across several chips with each contact pinned to one chip, a dry-run mode, and per-chip status.

## Stack

Node.js, [Baileys](https://github.com/WhiskeySockets/Baileys), pino, qrcode-terminal. Plain CSV files for contacts and send logs; no database.

## Usage

```bash
npm install
npm run teste -- exemplo --perfil chip1     # dry run, sends nothing
npm start -- exemplo --perfil chip1         # first run: scan the QR code
npm run diario -- exemplo --perfil chip1    # daily quota, no prompts
```

| Command | What it does |
|---|---|
| `npm run teste -- <campaign> --perfil <chip>` | Simulates, does not connect or send |
| `npm start -- <campaign> --perfil <chip>` | Sends (asks for confirmation) |
| `npm run diario -- <campaign> --perfil <chip>` | Sends only today's quota |
| `npm run chip -- ativar <chip> [date] [label]` | Starts a chip's warm-up |
| `npm run chip -- status` | Shows each chip's day and quota |
| `npm run exportar -- --perfil <p> --saida <csv>` | Exports a base from a number (read-only) |
| `npm run dividir -- <csv> --chips a,b,c` | Splits a base across chips |
| `npm run sair [perfil]` | Deletes the saved session |

A sample campaign with fake contacts is in `campanhas/exemplo/`. Pacing and quotas live in `config.json` and can be overridden per campaign in `campanha.json`.

## What is not in this repository

Session credentials, real contact lists, send logs, replies and the opt-out list are intentionally excluded (see `.gitignore`). Only send to people who have agreed to hear from you.

## Author

**Francielly Cunhago** · [github.com/franciellycunhago-cell](https://github.com/franciellycunhago-cell)
