/* ===== Barebones RPG – Step 3: EXP + Level + XP bar =====
   Parte da build core2b (cooldown + aggro) e aggiunge:
   - EXP/Level (cap 99)
   - EXP: +2 moneta, +20 uccisione nemico
   - Level Up: +10 MaxHP, HP full, +1 atkMin/atkMax, -20ms atkCd (min 200ms)
   - Barra XP sul canvas
*/

(() => {
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const statusEl = document.getElementById('status');
  const btnReset = document.getElementById('btnReset');

  // --- Mappa
  const COLS = 15, ROWS = 9;
  const TILE = 64; // 960x576
  const map = Array.from({length:ROWS}, ()=>Array(COLS).fill(0)); // 0 walk, 1 block

  function genBlocks(){
    for(let i=0;i<22;i++){
      const x = Math.floor(Math.random()*COLS);
      const y = Math.floor(Math.random()*ROWS);
      if((x===1 && y===1) || (x===COLS-2 && y===ROWS-2)) continue;
      map[y][x] = 1;
    }
  }
  genBlocks();

  // --- Stato
  const player = {
    x:1, y:1,
    hp:100, maxHp:100, coins:0,
    atkMin:6, atkMax:12,
    lastAtk:0, atkCd:400, // ms
    lvl:1, exp:0
  };
  const enemy  = {
    x:COLS-2, y:ROWS-2,
    hp:60, maxHp:60,
    tick:0,
    mode:'patrol', // 'patrol' | 'chase'
    lastHit:0, hitCd:800, // danno a contatto
    atkMin:5, atkMax:9
  };
  const coins  = [];

  // spawn monete
  function randEmpty(){
    for(let k=0;k<500;k++){
      const x = Math.floor(Math.random()*COLS);
      const y = Math.floor(Math.random()*ROWS);
      if(map[y][x]===0 && !(x===player.x && y===player.y) && !(x===enemy.x && y===enemy.y) && !coins.some(c=>c.x===x && c.y===y)){
        return {x,y};
      }
    }
    return {x:2,y:2};
  }
  for(let i=0;i<6;i++) coins.push(randEmpty());

  // --- Utilità
  const inside = (x,y)=> x>=0 && y>=0 && x<COLS && y<ROWS;
  const walkable = (x,y)=> inside(x,y) && map[y][x]===0;
  const clamp = (v,min,max)=> Math.max(min, Math.min(max, v));
  const manhattan = (a,b)=> Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const chebyshev = (a,b)=> Math.max(Math.abs(a.x-b.x), Math.abs(a.y-b.y));
  const randInt = (a,b)=> a + Math.floor(Math.random()*(b-a+1));

  // --- EXP / Level
  const MAX_LVL = 99;
  const XP_COIN = 2;
  const XP_KILL = 20;
  const xpNeeded = lvl => Math.floor(50 * Math.pow(lvl, 1.5));

  function gainXP(n){
    if(player.lvl >= MAX_LVL) return;
    player.exp += n;
    while(player.lvl < MAX_LVL && player.exp >= xpNeeded(player.lvl)){
      player.exp -= xpNeeded(player.lvl);
      levelUp();
    }
  }
  function levelUp(){
    player.lvl = Math.min(MAX_LVL, player.lvl + 1);
    player.maxHp += 10;
    player.hp = player.maxHp;
    player.atkMin += 1; player.atkMax += 1;
    player.atkCd = Math.max(200, player.atkCd - 20);
    // piccolo flash verde
    ctx.save();
    ctx.globalAlpha = .25;
    ctx.fillStyle = '#22c55e';
    ctx.fillRect(0,0,cv.width,cv.height);
    ctx.restore();
  }

  // --- BFS
  function bfs(sx,sy, tx,ty){
    if(!walkable(tx,ty)) return null;
    const q=[{x:sx,y:sy}], prev=new Map(), seen=new Set([`${sx},${sy}`]);
    const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
    while(q.length){
      const cur=q.shift();
      if(cur.x===tx && cur.y===ty){
        const path=[]; let k=`${tx},${ty}`;
        while(prev.has(k)){ const p=prev.get(k); const [cx,cy]=k.split(',').map(Number); path.push({x:cx,y:cy}); k=`${p.x},${p.y}`; }
        return path.reverse();
      }
      for(const d of dirs){
        const nx=cur.x+d[0], ny=cur.y+d[1], kk=`${nx},${ny}`;
        if(!walkable(nx,ny) || seen.has(kk)) continue;
        seen.add(kk); prev.set(kk,cur); q.push({x:nx, y:ny});
      }
    }
    return null;
  }

  // --- Input
  let pathQueue = [];
  function canvasToTile(ev){
    const r = cv.getBoundingClientRect();
    const sx = (ev.clientX - r.left) * (cv.width/r.width);
    const sy = (ev.clientY - r.top ) * (cv.height/r.height);
    const tx = clamp(Math.floor(sx / TILE), 0, COLS-1);
    const ty = clamp(Math.floor(sy / TILE), 0, ROWS-1);
    return {sx,sy,tx,ty};
  }

  function enemyRect(){
    const x = enemy.x*TILE + TILE/2 - 16;
    const y = enemy.y*TILE + TILE/2 - 22;
    return {x, y, w:32, h:36};
  }
  function pointInRect(px,py, r){ return px>=r.x && px<=r.x+r.w && py>=r.y && py<=r.y+r.h; }

  // Click: attacco se clicco il nemico ed è adiacente (8-dir) e CD pronto; altrimenti muovo
  cv.addEventListener('click', (ev)=>{
    const {sx,sy,tx,ty} = canvasToTile(ev);
    const now = performance.now();
    const cdReady = (now - player.lastAtk) >= player.atkCd;
    const adj8 = chebyshev(player, enemy)===1;

    const r = enemyRect();
    if(pointInRect(sx,sy,r) && adj8 && cdReady){ attackEnemy(); return; }
    if(tx===enemy.x && ty===enemy.y && adj8 && cdReady){ attackEnemy(); return; }

    const p = bfs(player.x, player.y, tx, ty);
    if(p && p.length) pathQueue = p;
  });

  // SPAZIO: attacco se adiacente e CD pronto
  window.addEventListener('keydown', (e)=>{
    if(e.code==='Space' || e.key===' '){
      const now = performance.now();
      if(chebyshev(player, enemy)===1 && (now - player.lastAtk) >= player.atkCd){
        attackEnemy();
      }
    }
  });

  btnReset.addEventListener('click', resetAll);

  function attackEnemy(){
    const now = performance.now();
    player.lastAtk = now;
    const dmg = randInt(player.atkMin, player.atkMax);
    enemy.hp = Math.max(0, enemy.hp - dmg);
    flashHit(enemy.x, enemy.y);
    if(enemy.hp===0){
      // drop moneta e respawn
      coins.push({x:enemy.x, y:enemy.y});
      gainXP(XP_KILL);
      const spot = randEmpty();
      enemy.x=spot.x; enemy.y=spot.y; enemy.hp=enemy.maxHp; enemy.mode='patrol';
    }
    draw();
  }

  // --- Nemico: patrol + chase
  function enemyAI(){
    const dist = manhattan(enemy, player);
    if(dist<=6) enemy.mode='chase';
    else if(dist>=10) enemy.mode='patrol';

    if(enemy.mode==='chase'){
      const options = [
        {x:enemy.x+1,y:enemy.y},{x:enemy.x-1,y:enemy.y},
        {x:enemy.x,y:enemy.y+1},{x:enemy.x,y:enemy.y-1}
      ].filter(p=>walkable(p.x,p.y) && !(p.x===player.x && p.y===player.y));
      options.sort((a,b)=> manhattan(a,player)-manhattan(b,player));
      const best = options[0];
      if(best) { enemy.x=best.x; enemy.y=best.y; }
    } else {
      enemy.tick = (enemy.tick+1)%8;
      if(enemy.tick===0){
        const dirs=[[1,0],[-1,0],[0,1],[0,-1],[0,0]];
        const d = dirs[Math.floor(Math.random()*dirs.length)];
        const nx=enemy.x+d[0], ny=enemy.y+d[1];
        if(walkable(nx,ny) && !(nx===player.x && ny===player.y)){ enemy.x=nx; enemy.y=ny; }
      }
    }
  }

  // --- Interazioni
  function handleInteractions(){
    // raccogli monete (+EXP)
    for(let i=coins.length-1;i>=0;i--){
      if(coins[i].x===player.x && coins[i].y===player.y){
        coins.splice(i,1);
        player.coins++;
        gainXP(XP_COIN);
      }
    }
    // danno a contatto / adiacenza
    const touching = chebyshev(player, enemy)===0;
    const adjacent = chebyshev(player, enemy)===1;
    const now = performance.now();
    if((touching || adjacent) && (now - enemy.lastHit) >= enemy.hitCd){
      enemy.lastHit = now;
      const dmg = randInt(enemy.atkMin, enemy.atkMax);
      player.hp = Math.max(0, player.hp - dmg);
      flashHit(player.x, player.y);
      if(player.hp===0){ gameOver(); }
    }
  }

  // --- Loop
  function step(){
    if(pathQueue.length){
      const next = pathQueue.shift();
      if(walkable(next.x,next.y) && !(next.x===enemy.x && next.y===enemy.y)){
        player.x = next.x; player.y = next.y;
      } else {
        pathQueue = [];
      }
    }
    enemyAI();
    handleInteractions();
    draw();
  }

  // --- Draw
  function draw(){
    ctx.clearRect(0,0,cv.width,cv.height);
    // tiles
    for(let y=0;y<ROWS;y++){
      for(let x=0;x<COLS;x++){
        ctx.fillStyle = (map[y][x]===1)? getVar('--block') : ((x+y)%2===0? getVar('--tileA') : getVar('--tileB'));
        ctx.fillRect(x*TILE, y*TILE, TILE, TILE);
      }
    }
    // coins
    ctx.fillStyle = getVar('--coin');
    for(const c of coins){
      const cx = c.x*TILE + TILE/2, cy = c.y*TILE + TILE/2;
      ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI*2); ctx.fill();
    }
    // enemy
    drawActor(enemy.x, enemy.y, getVar('--enemy'));
    drawHpBar(enemy.x, enemy.y, enemy.hp, enemy.maxHp);
    // player
    drawActor(player.x, player.y, getVar('--player'));
    drawHpBar(player.x, player.y, player.hp, player.maxHp);

    drawXpBar(); // <— nuova barra XP

    // HUD debug
    const now = performance.now();
    const cdRemain = Math.max(0, player.atkCd - (now - player.lastAtk));
    const cdPct = Math.round(100 * cdRemain / player.atkCd);
    const dist = manhattan(enemy, player);
    const need = player.lvl < MAX_LVL ? xpNeeded(player.lvl) : 0;
    const xpPct = player.lvl < MAX_LVL ? Math.floor(100*player.exp/need) : 100;

    statusEl.textContent =
      `build: core3 | LV ${player.lvl} | XP ${xpPct}% | CD ${cdRemain.toFixed(0)}ms (${cdPct}%) | enemy: ${enemy.mode} (dist=${dist}) | HP: ${player.hp}/${player.maxHp} | EHP: ${enemy.hp}/${enemy.maxHp} | monete: ${player.coins}`;
  }

  function drawActor(tx,ty,color){
    const x = tx*TILE, y = ty*TILE;
    // ombra
    ctx.fillStyle = getVar('--shadow');
    ctx.beginPath(); ctx.ellipse(x+TILE/2, y+TILE-12, 18, 6, 0, 0, Math.PI*2); ctx.fill();
    // corpo
    ctx.fillStyle = color;
    ctx.fillRect(x + TILE/2 - 16, y + TILE/2 - 22, 32, 36);
  }

  function drawHpBar(tx,ty,hp,maxHp){
    const x = tx*TILE, y = ty*TILE;
    const w = 40, h = 6;
    const px = x + TILE/2 - w/2;
    const py = y + TILE/2 - 32;
    const r = Math.max(0, Math.min(1, hp/maxHp));
    ctx.fillStyle = getVar('--hpBack'); ctx.fillRect(px, py, w, h);
    ctx.fillStyle = getVar('--hp');     ctx.fillRect(px, py, w*r, h);
    ctx.strokeStyle = '#0008'; ctx.strokeRect(px, py, w, h);
  }

  function drawXpBar(){
    // Barra XP orizzontale in alto
    const h = 10, pad = 6;
    const x = pad, y = pad, w = cv.width - pad*2;
    const need = player.lvl < MAX_LVL ? xpNeeded(player.lvl) : 1;
    const ratio = player.lvl < MAX_LVL ? Math.max(0, Math.min(1, player.exp/need)) : 1;
    ctx.fillStyle = '#0b1224aa'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#7c3aed';   ctx.fillRect(x, y, w*ratio, h);
    ctx.strokeStyle = '#1f2a44'; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#e5e7eb';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`LV ${player.lvl}${player.lvl<MAX_LVL?` — ${Math.floor(ratio*100)}%`:''}`, x, y+h+2);
  }

  function flashHit(tx,ty){
    const x = tx*TILE + TILE/2, y = ty*TILE + TILE/2;
    ctx.save();
    ctx.globalAlpha = .25;
    ctx.fillStyle = '#ff0000';
    ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function getVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // --- Reset / Game Over
  function resetAll(){
    for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) map[y][x]=0;
    genBlocks();
    player.x=1; player.y=1; player.hp=player.maxHp=100; player.coins=0; player.lastAtk=0;
    player.lvl=1; player.exp=0; player.atkMin=6; player.atkMax=12; player.atkCd=400;
    enemy.x=COLS-2; enemy.y=ROWS-2; enemy.hp=enemy.maxHp=60; enemy.tick=0; enemy.mode='patrol'; enemy.lastHit=0;
    coins.length=0; for(let i=0;i<6;i++) coins.push(randEmpty());
    pathQueue.length=0;
    draw();
  }
  function gameOver(){
    alert('Sei stato sconfitto! Resetto la partita.');
    resetAll();
  }

  // --- Start loop
  draw();
  setInterval(step, 120);
})();
