import { test } from "node:test";
import assert from "node:assert/strict";
import { Providers } from "../src/providers.mjs";
import { discordAsset } from "../src/artwork.mjs";
import { applyEvent, publicStatus } from "../src/state.mjs";

const first = "123456789012345678", second = "223456789012345678";
const art = "00112233445566778899aabbccddeeff";
const steamHash = "a".repeat(40);

test("the existing timezone-stamped Shortcut and shared end clear the current workout", () => {
  const rows = {};
  const now = Date.parse("2026-11-23T21:00:00Z");
  const start = {source:"workout",action:"start",kind:"running",at:"2026-11-23T14:00:00.125-06:00"};
  const end = {source:"workout",action:"end",kind:"any",at:"2026-11-23T14:30:00.250-06:00"};
  assert.equal(applyEvent(rows,start,{},now),true);
  assert.equal(applyEvent(rows,end,{},now),true);
  assert.equal(applyEvent(rows,end,{},now),false);
  assert.equal(publicStatus(rows,null,null,{},now).activity,null);
});

test("source-bound icons follow game switches, refuse scenes, recover Steam identity and clear on exit", async () => {
  let time = 0;
  let game = { name: "Game A", application_id: first, assets: { large_image: "222222" } };
  const provider = new Providers({ LANYARD_USER_ID: first }, {}, async url => {
    if (url.includes("lanyard.rest")) return Response.json({success:true, data:{activities:game ? [{type:0, ...game}] : []}});
    if (url.includes("IStoreBrowseService")) {
      const {ids} = JSON.parse(new URL(url).searchParams.get("input_json"));
      assert.deepEqual(ids,[{appid:321}]);
      return Response.json({response:{store_items:[{appid:321, name:"Game B", assets:{community_icon:steamHash}}]}});
    }
    const id = url.split("/").at(-2);
    if (id === first) return Response.json({id, name:"Game A", icon:art});
    return Response.json({id, name:"Rich Presence Tool", icon:art});
  }, () => time);
  async function read() { time += 9000; return publicStatus({}, null, null, {}, time, await provider.discord()).activity; }
  assert.deepEqual(await read(), {label:"Playing · Game A",kind:"gaming",icon:"https://cdn.discordapp.com/app-icons/"+first+"/"+art+".png?size=64",expiresAt:39000});
  assert.equal(discordAsset(first,"222222"), "https://cdn.discordapp.com/app-assets/"+first+"/222222.png");
  game = {name:"Game B", application_id:second, assets:{large_image:"mp:external/abc/https/cdn.fastly.steamstatic.com/steamcommunity/public/images/apps/321/"+steamHash+".jpg"}};
  assert.equal(discordAsset(second,game.assets.large_image), "https://media.discordapp.net/"+game.assets.large_image.slice(3));
  const switched = await read();
  assert.equal(switched.label,"Playing · Game B");
  assert.equal(switched.icon,"https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/321/"+steamHash+".jpg");
  game.name = "A different title";
  assert.equal((await read()).icon,undefined);
  game.assets = {large_image:"222222",small_image:"mp:attachments/100/200/portrait.png",large_text:"logo"};
  assert.equal((await read()).icon,undefined);
  game.assets = {};
  assert.equal((await read()).icon,undefined);
  game = null;
  assert.equal(await read(),null);
});
