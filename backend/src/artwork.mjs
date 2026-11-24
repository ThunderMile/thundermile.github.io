const snowflake = /^\d{17,20}$/;
const appID = /^\d{1,10}$/;
const sameTitle = (a, b) => typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();

// Resolving a rich-presence image does not establish what it depicts.
export function discordAsset(app, asset) {
  if (typeof asset !== "string") return null;
  if (snowflake.test(app) && /^\d+$/.test(asset)) return "https://cdn.discordapp.com/app-assets/" + app + "/" + asset + ".png";
  if (/^mp:(external|attachments)\/[A-Za-z0-9_./%~-]+$/.test(asset)) return "https://media.discordapp.net/" + asset.slice(3);
  return null;
}

function steamIconHint(resolved) {
  // External Steam community icons contain an app ID. Verify it with Steam before display.
  const match = resolved?.match(/^https:\/\/media\.discordapp\.net\/external\/[\w-]+\/https\/(?:[a-z0-9.-]+\.steamstatic\.com|media\.steampowered\.com)\/(?:steamcommunity\/public|community_assets)\/images\/apps\/(\d{1,10})\/[a-f\d]{40}\.jpg$/i);
  return match?.[1];
}

export async function steamArtwork(provider, id, title) {
  if (!appID.test(id)) return null;
  const game = await provider.cached("steam-art:" + id, async () => {
    const query = { ids: [{ appid: Number(id) }], context: { language: "english", country_code: "US" }, data_request: { include_assets: true } };
    const url = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=" + encodeURIComponent(JSON.stringify(query));
    const payload = await (await provider.get(url, {}, 1200)).json();
    const item = payload.response?.store_items?.find(item => String(item.appid) === String(id));
    const hash = item?.assets?.community_icon;
    if (!/^[a-f\d]{40}$/i.test(hash || "")) return null;
    return { title: item.name, icon: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/" + id + "/" + hash + ".jpg" };
  }, 3_600_000);
  return game && sameTitle(game.title, title) ? game.icon : null;
}

export async function discordArtwork(provider, activity) {
  const id = activity.application_id;
  if (snowflake.test(id || "")) {
    const app = await provider.cached("discord-art:" + id, async () => {
      const data = await (await provider.get("https://discord.com/api/v10/applications/" + id + "/rpc", {}, 1200)).json();
      if (data.id !== id) return null;
      return { title: data.name, hash: data.icon, steamID: data.third_party_skus?.find(entry => entry.distributor === "steam")?.sku };
    }, 3_600_000);
    if (app && sameTitle(app.title, activity.name)) {
      if (/^(?:a_)?[a-f\d]{32}$/i.test(app.hash || "")) return "https://cdn.discordapp.com/app-icons/" + id + "/" + app.hash + ".png?size=64";
      if (app.steamID) {
        const icon = await steamArtwork(provider, app.steamID, activity.name);
        if (icon) return icon;
      }
    }
  }
  for (const asset of [activity.assets?.large_image, activity.assets?.small_image]) {
    const steamID = steamIconHint(discordAsset(id, asset));
    if (steamID) {
      const icon = await steamArtwork(provider, steamID, activity.name);
      if (icon) return icon;
    }
  }
  return null;
}
