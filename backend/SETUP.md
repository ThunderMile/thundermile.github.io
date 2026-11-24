# Portfolio status

The GitHub Pages homepage reads the [shared status](https://mile-portfolio-status.thundermile.workers.dev/api/status) over HTTPS. A fresh Watch workout takes priority over the current Discord game. The basic Watch timer displays elapsed time, including pauses. A workout end clears the timer and the next poll restores the current game or idle state. Discord supplies the Playing title. The Worker verifies application artwork and the homepage uses the pixel gamepad when artwork is unavailable.

## Update the two existing iPhone Shortcuts

1. Open **Shortcuts** and edit the start shortcut. In **Get Contents of URL**, set the URL to `https://mile-portfolio-status.thundermile.workers.dev/api/events` and the method to **POST**. If a **URL** action feeds the request, edit that action.
2. Expand **Headers**, set `Content-Type` to `application/json`, then add `Authorization` with the value `Bearer ` followed by your private production token. The space after `Bearer` is required. Keep this value in your private Shortcut or password manager.
3. Repeat for the end shortcut. If both automations call a single sender, update that sender once. Keep the existing **JSON** body and timezone-bearing `at`. Select the workout on your Watch as usual.

| Event | Fields |
|---|---|
| Workout start | `source=workout`, `action=start`, `kind`, `at` |
| Workout end | `source=workout`, `action=end`, `at`. An existing `kind` field is accepted. |

Supported kinds are `running`, `swimming`, `strength`, `jump_rope` and `badminton`. An accepted event returns `{"applied":true}`. A duplicate or older event returns `{"applied":false}`. Retry the same timestamp after a network failure.

## Local preview and deployment

From `backend`, run `pnpm install --frozen-lockfile`, `pnpm test`, then `pnpm preview` using Node 24. The desktop preview is [http://127.0.0.1:8768/](http://127.0.0.1:8768/). Private preview state stays under the ignored `.preview-data` directory.

Production uses Cloudflare Workers with a SQLite-backed Durable Object, the configured Lanyard account, and `PUBLIC_HEART_RATE=false`. The Worker stores the production bearer as the encrypted `WRITE_TOKEN` secret. To deploy a reviewed change, run `pnpm exec wrangler login` followed by `pnpm deploy` in `backend`. Set or rotate the secret privately with `pnpm exec wrangler secret put WRITE_TOKEN`. The public URL in `assets/profile-config.mjs` points the Pages frontend at this Worker. GitHub Pages publishes the repository root of `main`.
