# Portfolio status

The GitHub Pages homepage reads the [shared status](https://mile-portfolio-status.thundermile.workers.dev/api/status) over HTTPS. A fresh Watch workout takes priority over the current Discord game. The **Since start** timer includes pauses. A workout end clears the timer and restores the next eligible activity. Discord supplies the Playing title and a recognized League of Legends mode when the presence includes one. The Worker verifies application artwork and the homepage uses the pixel gamepad when artwork is unavailable.

## Apple Watch Workout automations

Start and end workouts in Apple's built-in **Workout** app. The existing automations update the fox and elapsed-since-start timer. Apple Fitness records the workout as usual. Keep the working automations installed. For a new setup, use the same contract below.

1. Open **Shortcuts** and edit the start shortcut. In **Get Contents of URL**, set the URL to `https://mile-portfolio-status.thundermile.workers.dev/api/events` and the method to **POST**. If a **URL** action feeds the request, edit that action.
2. Expand **Headers**, set `Content-Type` to `application/json`, then add `Authorization` with the value `Bearer ` followed by your private production token. The space after `Bearer` is required. Keep this value in your private Shortcut or password manager.
3. Repeat for the end shortcut. If both automations call a single sender, update that sender once. Keep the existing **JSON** body and timezone-bearing `at`. Select the workout on your Watch as usual.

| Event | Fields |
|---|---|
| Workout start | `source=workout`, `action=start`, `kind`, `at` |
| Workout end | `source=workout`, `action=end`, `at`. An existing `kind` field is accepted. |

Supported kinds are `running`, `swimming`, `strength`, `jump_rope` and `badminton`. An accepted event returns `{"applied":true}`. A duplicate or older event returns `{"applied":false}`. Retry the same timestamp after a network failure.

For a separate local app-action test, create **Shortcuts → Automation → Apple Watch Workout** with a single **Workout Type** and **Starts → Run Immediately**. Add **Health Preview → Start Workout** with that type selected. For the end, use **Any Workout → Ends → Run Immediately → Health Preview → End Workout**. The existing POST automations can run alongside these test automations. The local actions use the app's saved backend and token. The start and end triggers do not report pause or active running distance.

## iPhone Health Preview

Open `devices/HealthPreview.xcodeproj` in Xcode and select the `HealthPreview` scheme. In **Health Preview → Sync Settings**, save the HTTPS Worker origin and the private write token. The iPhone stores both in Keychain. The optional **Start Workout** and **End Workout** app actions use the same event format as the existing POST actions. For Sleep Focus automations, use **Start Bedtime** when Sleep turns on and **End Bedtime** when it turns off.

Turn on **Share Apple Music** in **Sync Settings** and allow **Media & Apple Music** access. Health Preview reads the built-in Music player's playback state and current track. While the app is active, it reports playback changes and refreshes a playing track about every 30 seconds. The Worker and page expire the original observation after 90 seconds. iOS can suspend Health Preview when you leave it or lock the phone. The music row stays hidden until the phone sends a playing track with a readable title.

The heart is independent of the fox activity. **Share heart rate** in the iPhone app and `PUBLIC_HEART_RATE=true` on the Worker enable display of recent authorized Apple Watch samples from the iPhone's HealthKit store. The app waits for Watch readings through HealthKit. The page shows the latest sample for up to 20 minutes from its original measurement time, allowing for variable background sampling intervals. **Last update** includes the latest shared heart measurement time. After expiry, the placeholder is `♡ --`. [Apple Watch sampling](https://support.apple.com/en-lamr/120277)

Sleep Focus supplies the bedtime clock. **Share observed sleep stages** and `PUBLIC_SLEEP_STAGE=true` enable separately timestamped Watch observations for up to two minutes after the interval ends. The app's **Sync Saved Run** and **Sync Last Sleep** send private summaries to `POST /api/health/summaries`. Automatic summary sync is off by default and uses HealthKit background delivery on physical iPhone when enabled.

### Physical device preview

1. Select the connected iPhone as the **HealthPreview** run destination. In **Signing & Capabilities**, select the development team that can provision HealthKit. Build the Debug configuration and open the app.
2. From `backend`, run `PORTFOLIO_WIFI_IP=<Mac-private-IPv4> PUBLIC_HEART_RATE=true node preview.mjs --device`. The Mac browser uses [http://127.0.0.1:8768/](http://127.0.0.1:8768/). The preview listens for authenticated writes at the specified private IP and runs with temporary Worker state and a dedicated test token. It reads game presence from the same Discord account as the public site.
3. In **Sync Settings**, save `http://<Mac-private-IPv4>:8768` and the private token from `backend/.preview-data/device-write-token`. Allow local network access when prompted. **Development → Check Local Backend** confirms connectivity and authentication without changing activity. Release builds use HTTPS.
4. Authorize reading in Health Preview and enable **Share heart rate** for the test backend. In **Health Delivery Timing**, enable **Record Watch delivery timing**. The app records each sample's observation interval and when it first became readable to the app. **Read Available Samples** checks the last hour of readable heart-rate data. Backend receipt times are in the ignored `backend/.preview-data/device-delivery-*.jsonl` files.

For an overnight test, on the Watch use **Settings → Sleep → Sleep Tracking**. Charge the Watch to at least 30 percent and wear it to bed. Open the iPhone's **Health Delivery Timing** and enable recording before locking the phone. In the morning compare **Sleep** in the iPhone Health app against the interval and first-read times in Health Preview. The timing view records background versus active reads and protected-data availability. Stage sharing can stay off during this test.

### Location and local Bilibili preview

In **Sync Settings → Location Sharing**, use **Set Home Here** or **Set School Here** while in that region. Tap **Share coarse location** and **Update Location Now** to check the displayed label. **Allow Background Updates** requests the permission needed for region and significant-location events. The coordinates are stored on the iPhone. The site receives only Home, School or Travel with a city name. A label expires after 24 hours without an update.

The local preview enables the Bilibili app-open signal. In iPhone **Shortcuts → Automation**, create **App → 哔哩哔哩 → Is Opened → Run Immediately → Health Preview → Set Bilibili Presence** with **App Is Open** on. Create a second automation with **Is Closed** and **App Is Open** off. The signal has a 90-minute timeout and tells the preview only whether the app was opened or left.

## Isolated simulator demo

From `backend`, run `node preview.mjs --ephemeral` and open `http://127.0.0.1:8768/` in a Mac browser. In the iPhone simulator's **Sync Settings**, set the URL to `http://127.0.0.1:8768` and privately enter the local token from `backend/.preview-data/simulator-write-token`. Use **Start Workout · Running** and **End Workout** in the simulator settings to send test events. Simulator builds accept only a loopback backend. `pnpm test` covers the heart display with synthetic samples.

## Local preview and deployment

From `backend`, run `pnpm install --frozen-lockfile`, `pnpm test`, then `pnpm preview` using Node 24. The desktop preview is [http://127.0.0.1:8768/](http://127.0.0.1:8768/). Private preview state stays under the ignored `.preview-data` directory.

Production uses Cloudflare Workers with a SQLite-backed Durable Object, the configured Lanyard account, and `MUSIC_PROVIDER=push`. Public heart-rate and sleep-stage sharing are disabled in the production configuration. The Worker stores the production bearer as the encrypted `WRITE_TOKEN` secret. To deploy a reviewed change, run `pnpm exec wrangler login` followed by `pnpm deploy` in `backend`. Set or rotate the secret privately with `pnpm exec wrangler secret put WRITE_TOKEN`. The public URL in `assets/profile-config.mjs` points the Pages frontend at this Worker. GitHub Pages publishes the repository root of `main`.
