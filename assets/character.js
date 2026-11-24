/* Original 144 × 80 pixel scenes. Each call paints exactly one still frame. */
(() => {
  "use strict";
  const WIDTH = 144;
  const HEIGHT = 80;
  const ink = "#25354a";
  const fur = "#eb9257";
  const cream = "#fff0cd";
  const jacket = "#376db0";
  const cuff = "#91cadd";
  const bark = "#825953";
  const palette = {
    k: ink, f: fur, s: "#bd6948", h: "#ffc27b", p: "#cf7c78",
    m: "#e4c59c", w: cream, b: jacket, d: "#294a7a", c: cuff,
    a: "#eab263"
  };
  let ctx;
  function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }
  // Integer scanlines keep diagonals and curves crisp on every browser.
  function oval(cx, cy, rx, ry, color) {
    for (let y = -ry; y <= ry; y++) {
      const span = Math.round(rx * Math.sqrt(1 - (y / ry) ** 2));
      rect(cx - span, cy + y, 2 * span + 1, 1, color);
    }
  }
  function polygon(points, color) {
    const ys = points.map(point => point[1]);
    for (let y = Math.min(...ys); y < Math.max(...ys); y++) {
      const scan = y + 0.5;
      const cuts = [];
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        if ((y1 > scan) !== (y2 > scan)) cuts.push(x1 + (x2 - x1) * (scan - y1) / (y2 - y1));
      }
      cuts.sort((a, b) => a - b);
      for (let i = 0; i + 1 < cuts.length; i += 2) {
        rect(Math.ceil(cuts[i]), y, Math.ceil(cuts[i + 1]) - Math.ceil(cuts[i]), 1, color);
      }
    }
  }
  function line(points, color, weight = 1) {
    const offset = Math.floor(weight / 2);
    for (let i = 1; i < points.length; i++) {
      const [x, y] = points[i - 1];
      const dx = points[i][0] - x, dy = points[i][1] - y;
      const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
      for (let n = 0; n <= steps; n++) {
        rect(Math.round(x + n * dx / steps) - offset, Math.round(y + n * dy / steps) - offset, weight, weight, color);
      }
    }
  }
  function stamp(rows, x, y) {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length;) {
        const key = row[i], start = i++;
        while (row[i] === key) i++;
        if (palette[key]) rect(x + start, y + j, i - start, 1, palette[key]);
      }
    });
  }
  const headArt = [
    "..kkk.............kkk..",
    "..kfskk.........kksfk..",
    "..kfpffkk.....kkffpfk..",
    "..kfppfffkkkkkfffppfk..",
    "..kfppfffffffffffppfk..",
    "..kfsffhhhffffhfffsfk..",
    "..ksffhhhffffhhhfffsk..",
    ".ksffffhffffffhfffffsk.",
    "..kffffffffffffffffsk..",
    ".ksfffffffhfffffffffsk.",
    "kfsfffhfffhfffffhffffsk",
    ".ksmmwwffhhhhhffwwmmsk.",
    "kfswwwwwfhhhhhhfwwwwfsk",
    ".kswwwwwwwhhwwwwwwwwsk.",
    "..kmmwwwwwwwwwwwwwmmk..",
    "...kkmwwwwwwwwwwwmkk...",
    ".....kkmwwwwwwwmkk.....",
    ".......kkmmmmmkk.......",
    ".........kkkkk........."
  ];
  const coatArt = [
    "....kkkkkkkkkk....",
    "..kkbbccccccbbkk..",
    ".kdbbbbkcckbbbbdk.",
    ".kdbbbbdckbbbbbdk.",
    ".kdbbbbdcbbbabbdk.",
    ".kdbbbbdcbbacbbdk.",
    ".kdbbbbdcbbbbbbdk.",
    ".kddbbbdcbbddbbdk.",
    ".kddbbbdcbbccbbdk.",
    "..kdbbbdcbbbbbdk..",
    "..kcccckcckcccck..",
    "...kkkkkkkkkkkk..."
  ];
  const tailArt = [
    "kkk..............",
    "kwwkk............",
    "kwwwmkk..........",
    ".kmwwmfkk........",
    ".kmmfffffkk......",
    "..ksffhhfffkk....",
    "..ksfffhhhfffkk..",
    "...ksfffffffffsk.",
    "....ksffffffffsk.",
    ".....kkssffffsk..",
    ".......kksssssk..",
    ".........kkkkk..."
  ];
  function head(x, y, blink, gaze = 0) {
    stamp(headArt, x - 11, y - 10);
    for (const eye of [-4, 5]) {
      rect(x + eye + gaze, y, 2, blink ? 1 : 3, ink);
      if (!blink) rect(x + eye + gaze, y, 1, 1, "#fff9dc");
    }
    rect(x + 1, y + 3, 3, 2, ink);
    rect(x + 2, y + 5, 1, 1, ink);
    rect(x + 3, y + 6, 2, 1, "#a75e4b");
  }
  function coat(x, y) { stamp(coatArt, x - 9, y); }
  function arm(shoulder, elbow, paw) {
    line([shoulder, elbow, paw], ink, 5);
    line([shoulder, elbow, paw], jacket, 3);
    rect(paw[0] - 2, paw[1] - 1, 4, 3, fur);
    rect(paw[0] + 1, paw[1] - 1, 1, 2, "#ffd28c");
  }
  function leg(hip, knee, foot) {
    line([hip, knee, foot], ink, 5);
    line([hip, knee, foot], "#515e7a", 3);
    rect(foot[0] - 2, foot[1] - 1, 7, 3, ink);
    rect(foot[0] - 1, foot[1] - 1, 5, 1, cream);
  }
  function cloud(x, y, width) {
    const color = "#fffae7";
    rect(x, y + 3, width, 2, "#c5dddc");
    rect(x - 2, y + 1, width + 3, 2, color);
    rect(x + 2, y - 1, width - 5, 3, color);
    rect(x + 6, y - 3, 7, 4, color);
  }
  function pine(x, y, size, color) {
    rect(x, y + size - 2, 2, 5, color);
    polygon([[x + 1,y],[x + size / 2,y + size],[x - size / 2,y + size]], color);
    polygon([[x + 1,y - 3],[x + size / 2 - 1,y + size - 4],[x - size / 2 + 1,y + size - 4]], color);
  }
  function grass(x, y, color) {
    rect(x, y, 1, 2, color); rect(x + 1, y + 2, 3, 1, color); rect(x + 4, y - 1, 1, 3, color);
  }
  function flower(x, y, color) {
    rect(x, y + 2, 1, 3, "#437b66"); rect(x - 1, y, 3, 1, color);
    rect(x, y - 1, 1, 3, color); rect(x, y, 1, 1, "#f0b86a");
  }
  function landscape(pool) {
    rect(0, 0, WIDTH, HEIGHT, "#b9dfdf");
    rect(0, 25, WIDTH, 15, "#c9e6df"); rect(0, 40, WIDTH, 9, "#dfecda");
    oval(109, 13, 6, 6, "#fff0bc"); cloud(7, 12, 28); cloud(80, 8, 16); cloud(119, 23, 19);
    polygon([[0,40],[14,36],[26,39],[46,30],[64,39],[83,32],[101,38],[122,29],[144,35],[144,54],[0,54]], "#a6cbc0");
    polygon([[0,43],[18,41],[37,46],[60,38],[77,42],[101,36],[115,38],[132,34],[144,36],[144,55],[0,55]], "#8fbaa9");
    for (const [x,y,s] of [[2,32,12],[9,35,10],[16,35,8],[26,38,6],[116,37,8],[125,33,10],[133,29,14],[142,33,10]]) {
      pine(x, y, s, "#6d9f91");
    }
    rect(0, 46, WIDTH, 14, "#9bc8c3");
    for (const [x,y,w] of [[1,47,22],[46,48,8],[54,50,13],[8,52,8],[106,50,17],[123,48,11]]) rect(x, y, w, 1, "#cce0d2");
    if (pool) return;
    polygon([[0,51],[18,49],[35,51],[62,51],[81,53],[110,50],[144,48],[144,80],[0,80]], "#9db97d");
    polygon([[0,58],[18,56],[47,57],[82,55],[111,56],[144,54],[144,80],[0,80]], "#bdd094");
    polygon([[0,67],[26,62],[48,61],[81,62],[111,60],[144,58],[144,65],[108,68],[47,68],[20,71],[0,75]], "#d9d5a3");
    for (const [x,y] of [[5,59],[26,55],[43,72],[95,69],[127,56],[132,71],[18,75],[108,53]]) grass(x,y,"#8ba775");
    flower(12,63,"#fff2c5"); flower(16,62,"#fff2c5"); flower(118,71,"#ffe4a4"); flower(121,72,"#fff3d1");
  }
  function windowScene(night) {
    rect(0,0,WIDTH,HEIGHT,night ? "#4c536d" : "#ecdcbd");
    rect(0,0,WIDTH,2,night ? "#5d617b" : "#f4e8d0");
    rect(0,50,WIDTH,4,night ? "#373d54" : "#b9a58d");
    rect(0,54,WIDTH,26,night ? "#575266" : "#ceae8d");
    for (const [x,y,w] of [[0,63,144],[0,74,144],[32,59,13],[107,68,10],[8,70,9]]) rect(x,y,w,1,night ? "#4a495e" : "#c5a586");
    rect(10,8,38,32,night ? "#32374e" : "#9f9384");
    rect(12,10,34,26,night ? "#415579" : "#b3dad9");
    if (night) {
      oval(22,17,4,4,"#ffe3a8"); oval(24,15,3,3,"#415579");
      for (const [x,y] of [[15,12],[38,17],[32,12],[41,21]]) rect(x,y,1,1,"#e4debc");
    } else {
      rect(14,17,9,2,"#fff6db"); rect(17,15,4,2,"#fff6db");
    }
    for (const [x,h] of [[13,5],[18,8],[24,4],[33,7],[38,9],[42,5]]) rect(x,36-h,4,h,night ? "#303d5b" : "#88b3ac");
    rect(28,10,2,26,night ? "#68627a" : "#d2c3a5"); rect(12,23,34,2,night ? "#68627a" : "#d2c3a5");
    rect(8,37,42,3,night ? "#777087" : "#ddc6a4");
    rect(119,31,17,2,night ? "#363b50" : "#a68571");
    for (const [x,h,c] of [[121,6,"#628d87"],[125,8,"#bc8466"],[129,5,"#6f849a"]]) rect(x,31-h,3,h,c);
  }
  function desk(x, y) {
    rect(x, y, 44, 3, ink); rect(x + 1, y, 42, 1, "#dda978");
    rect(x + 3, y + 3, 3, 66-y, bark); rect(x + 37, y + 3, 3, 66-y, bark);
    rect(x + 6, y + 3, 31, 3, "#aa795c");
  }
  function chair(x) {
    rect(x,46,4,14,ink); rect(x+1,47,2,9,"#63899b");
    rect(x,58,18,4,ink); rect(x+1,58,16,1,cuff);
    rect(x+2,62,2,7,bark); rect(x+14,62,2,7,bark);
  }
  const stride = [-6,-4,0,4,6,4,0,-4];
  const lift = [0,1,3,4,3,1,0,0];
  function standing(mode, phase, blink) {
    landscape(false);
    const step = stride[phase];
    const run = mode === "running";
    const rope = mode === "jump_rope";
    const play = mode === "badminton";
    const bounce = rope ? lift[phase] : run ? [0,1,2,1,0,1,2,1][phase] : Number(phase === 3 || phase === 4);
    const x = 72 + (play ? Math.round(step / 2) : 0), y = 65 - bounce;
    oval(72,66,rope ? 10-bounce : 14,2,"#9baf81");
    if (rope) {
      const curve = [[x-15,y-12],[x-18,y-20],[x-18,y-33],[x-12,y-42],[x,y-45],[x+12,y-42],[x+18,y-33],[x+18,y-20],[x+15,y-12]];
      const offset = [0,7,17,30,49,31,18,5][phase];
      const ropePath = curve.map(([px,py],i) => [px, py+Math.round(offset*(1-Math.abs(4-i)/4))]);
      line(ropePath,"#b96654",2);
    }
    stamp(tailArt,x-23,y-19-(phase===2 || phase===3 ? 1 : 0));
    if (run) {
      const back = stride[(phase+4)%8];
      leg([x-4,y-9],[x-4+Math.round(back/2),y-4],[x-4+back,y-(back<0?4:0)]);
      leg([x+3,y-9],[x+3+Math.round(step/2),y-4],[x+3+step,y-(step<0?4:0)]);
    } else {
      leg([x-4,y-9],[x-5,y-5],[x-6-(play?2:0),y]);
      leg([x+3,y-9],[x+4,y-5],[x+4+(play?3:0),y]);
    }
    coat(x,y-20);
    if (mode === "strength") {
      const high = [0,2,6,11,12,11,6,2][phase];
      for (const side of [-1,1]) {
        const hand = [x+side*15,y-22-high];
        arm([x+side*7,y-18],[x+side*13,y-16-high],hand);
        rect(hand[0]-5,hand[1]-2,11,2,"#bbc7c7");
        for (const offset of [-6,4]) {
          rect(hand[0]+offset,hand[1]-5,3,7,ink);
          rect(hand[0]+offset,hand[1]-4,1,4,"#72849b");
        }
      }
    } else if (play) {
      const tip = [[17,-32],[21,-37],[27,-30],[29,-22],[28,-15],[24,-13],[19,-18],[16,-25]][phase];
      const hand = [x+11+Math.round(step/2),y-16];
      const racket = [x+tip[0],y+tip[1]];
      arm([x-6,y-17],[x-11,y-15],[x-12,y-17]);
      arm([x+6,y-17],[x+9,y-15],hand);
      line([hand,racket],ink,2); oval(...racket,4,5,ink); oval(...racket,3,4,cuff);
      for (const dx of [-1,1]) rect(racket[0]+dx,racket[1]-2,1,5,"#68929a");
      rect(racket[0]-2,racket[1],5,1,"#68929a");
      const birdX = x+[19,24,31,38,44,48,46,34][phase], birdY = y- [37,42,45,46,44,41,38,36][phase];
      polygon([[birdX-2,birdY-2],[birdX+3,birdY-3],[birdX+2,birdY+2],[birdX,birdY+2]],cream); rect(birdX-1,birdY+1,2,2,"#ac775a");
    } else if (rope) {
      for (const side of [-1,1]) {
        arm([x+side*7,y-17],[x+side*11,y-12],[x+side*15,y-13]);
        rect(x+side*15-1,y-14,2,3,bark);
      }
    } else if (run) {
      arm([x-6,y-17],[x-8-step,y-13],[x-6-step,y-17]);
      arm([x+6,y-17],[x+9+step,y-13],[x+12+step,y-17]);
    } else {
      arm([x-6,y-17],[x-8,y-13],[x-8,y-10]);
      arm([x+6,y-17],[x+8,y-13],[x+6,y-11]);
    }
    head(x+(run?1:0),y-27,blink,run||play ? 1 : 0);
  }
  function seated(mode, phase, blink) {
    windowScene(false);
    const x = mode === "video" ? 72 : 61;
    chair(x-9);
    stamp(tailArt,x-22,49);
    leg([x-3,56],[x+4,59],[x+4,67]); leg([x+3,56],[x+9,59],[x+10,67]);
    coat(x,46);
    head(x,39+Number(phase===3),blink,1);
    if (mode === "video") {
      const scroll = [1,1,0,-1,-2,0,1,1][phase];
      arm([x-5,48],[x-5,53],[x+5,50]);
      rect(x+8,42,8,13,ink); rect(x+9,44,6,8,"#b9d9dc");
      rect(x+10,46+scroll,4,2,jacket); rect(x+10,49+scroll,3,1,"#e3ae76");
      arm([x+6,49],[x+8,55],[x+10,49+scroll]);
      return;
    }
    desk(x+5,53);
    if (mode === "class") {
      polygon([[x+12,50],[x+25,50],[x+28,53],[x+11,53]],"#fff8d9");
      rect(x+14,51,7,1,"#a3b2b1"); rect(x+20,52,5,1,"#a3b2b1");
      const pen = x+13+[0,1,2,3,4,5,2,0][phase];
      arm([x+5,47],[x+7,51],[pen,50]);
      line([[pen,51],[pen+3,45]],bark); rect(pen+3,45,1,1,"#e3a865");
      arm([x-5,49],[x-4,53],[x+6,52]);
    } else {
      rect(x+22,31,21,16,ink); rect(x+24,33,17,11,phase<4?"#629ba9":"#75a9b1");
      rect(x+26,35,4,1,"#d4e8cd"); rect(x+33+Math.round(stride[phase]/4),39,2,2,"#ffe4a6");
      rect(x+25,42,15,1,"#335f81"); rect(x+30,47,3,4,ink); rect(x+27,51,10,1,ink);
      rect(x+8,51,14,2,ink); rect(x+10,51,10,1,"#9daeb0");
      arm([x+5,48],[x+8,50],[x+14,49+Number(phase%3===0)]);
      arm([x-5,49],[x-4,53],[x+8,51-Number(phase%3===1)]);
    }
  }
  function swim(phase, blink) {
    landscape(true);
    rect(0,52,WIDTH,28,"#75b8bd"); rect(0,68,WIDTH,12,"#65a9b3");
    const wave = Math.round(stride[phase]/3);
    for (const [x,y,w] of [[7,59,15],[36,55,9],[17,69,19],[39,76,12],[97,70,17],[119,54,11],[122,63,9]]) {
      rect(x+wave,y,w,1,"#b5ddd5"); rect(x+wave+3,y-1,w-6,1,"#b5ddd5");
    }
    const y=52+Number(phase===3 || phase===7);
    stamp(tailArt,40,y-8);
    leg([57,y],[52,y-1],[48,y-2+wave]);
    leg([58,y+3],[53,y+4],[48,y+4-wave]);
    oval(64,y,13,6,ink); oval(65,y-1,12,5,jacket); rect(59,y-4,9,1,cuff);
    const reach = [[-8,-8],[-5,-12],[2,-12],[8,-8],[13,-4],[9,0],[1,2],[-6,1]];
    function stroke(index, offset) {
      const [dx,dy]=reach[index];
      arm([68,y],[68+Math.round(dx/2),y+dy-2],[68+dx+offset,y+dy]);
    }
    stroke((phase+4)%8,3); head(82,y-5,blink,1); stroke(phase,1);
    rect(49+wave,y+5,14,1,"#cee9dc"); rect(74-wave,y+6,15,1,"#cee9dc"); rect(90+wave,y+2,8,1,"#cee9dc");
  }
  function bed(phase, blink) {
    windowScene(true);
    rect(32,46,4,22,ink); rect(34,45,1,18,"#a47e6b");
    rect(107,51,4,17,ink); rect(108,52,1,13,"#a47e6b");
    rect(35,54,72,8,"#b9acaa"); rect(35,62,73,3,bark);
    oval(54,52,15,5,"#e5cdb3"); rect(42,53,24,2,"#d4bda7");
    const rise = Number(phase>=3 && phase<=5);
    head(56,45-rise,blink,1);
    polygon([[35,55],[49,55],[62,50-rise],[69,46-rise],[87,47-rise],[97,51],[107,54],[107,62],[35,62]],"#40658c");
    polygon([[35,55],[49,55],[62,50-rise],[69,46-rise],[87,47-rise],[98,52],[107,54],[107,58],[35,58]],"#7296ad");
    line([[55,54],[65,49-rise],[69,48-rise]],"#c2d7cc",2);
    for (const [x,y] of [[76,50],[87,53],[66,56],[98,56]]) rect(x,y-rise,3,1,"#a2c0c1");
  }
  const activities = {
    idle: standing, running: standing, strength: standing, jump_rope: standing, badminton: standing,
    class: seated, gaming: seated, video: seated
  };
  window.characterFrames = 24;
  window.drawCharacter = (canvas, activity = "idle", frame = 0) => {
    if (canvas.width !== WIDTH) canvas.width = WIDTH;
    if (canvas.height !== HEIGHT) canvas.height = HEIGHT;
    ctx = canvas.getContext("2d");
    if (!ctx) return;
    const tick = Math.max(0, Math.floor(frame)) % window.characterFrames;
    const phase = tick % 8, blink = tick === 23;
    ctx.imageSmoothingEnabled = false;
    if (activity === "swimming") swim(phase,blink);
    else if (activity === "bedtime") bed(phase,blink);
    else if (Object.hasOwn(activities, activity)) activities[activity](activity,phase,blink);
    else standing("idle",phase,blink);
  };
})();
