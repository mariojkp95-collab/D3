/* ===== Barebones RPG – Step 1 FIX: click hit-test + adiacenza 8-dir ===== */

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
  const player = {x:1, y:1, hp:100, maxHp:100, coins:0, atkMin:6, atkMax:12};
  const enemy  = {x:COLS-2, y:ROWS-2, hp:60, maxHp:60, tick:0};
  const coins  = [];

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

  // Hit-test preciso sul rettangolo grafico del nemico
  function enemyRect(){
    const x = enemy.x*TILE + TILE/2 - 16;
    const y = enemy.y*TILE + TILE/2 - 22;
    return {x, y, w:32, h:36};
  }
  function pointInRect(px,py, r){ return px>=r.x && px<=r.x+r.w && py>=r.y && py<=r.y+r.h; }

  // Click:
  // 1) se clicco “sul nemico” e sono ADIACENTE (8 direzioni) → attacco
  // 2) altrimenti, se clicco la sua tile ed è adiacente → attacco
  // 3) altrimenti → pathfinding
  cv.addEventListener('click', (ev)=>{
    const {sx,sy,tx,ty} = canvasToTile(ev);
    const adj8 = chebyshev(player, enemy)===1;

    // (1) hit-test pixel
    const r = enemyRect();
    if(pointInRect(sx,sy,r) && adj8){
      attackEnemy(); return;
    }
    // (2) tile-attack fallback
    if(tx===enemy.x && ty===enemy.y && adj8){
      attackEnemy(); return;
    }
    // (3) movimento
    const p = bfs(player.x, player.y, tx, ty);
    if(p && p.length) pathQueue = p;
  });

  // Tasto SPAZIO: attacco se nemico adiacente (8-dir)
  window.addEventListener('keydown', (e)=>{
    if(e.code==='Space' || e.key===' '){
      if(chebyshev(player, enemy)===1) attackEnemy();
    }
  });

  btnReset.addEventListener('click', resetAll);

  function attackEnemy(){
    const dmg = randInt(player.atkMin, player.atkMax);
    enemy.hp = Math.max(0, enemy.hp - dmg);
    flashHit(enemy.x, enemy.y);
    if(enemy.hp===0){
      // droppa 1 moneta e respawna altrove
      coins.push({x:enemy.x, y:enemy.y});
      const spot = randEmpty();
      enemy.x=spot.x; enemy.y=spot.y; enemy.hp=enemy.maxHp;
    }
    draw();
  }

  // --- Nemico: pattuglia random semplice
  function enemyAI(){
    enemy.tick = (enemy.tick+1)%12;
    if(enemy.tick===0){
      const dirs=[[1,0],[-1,0],[0,1],[0,-1],[0,0]];
      const d = dirs[Math.floor(Math.random()*dirs.length)];
      const nx=enemy.x+d[0], ny=enemy.y+d[1];
      if(walkable(nx,ny) && !(nx===player.x && ny===player.y)){
        enemy.x=nx; enemy.y=ny;
      }
    }
  }

  // --- Interazioni
  function handleInteractions(){
    // raccogli monete
    for(let i=coins.length-1;i>=0;i--){
      if(coins[i].x===player.x && coins[i].y===player.y){
        coins.splice(i,1);
        player.coins++;
      }
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

    statusEl.textContent = `HP: ${player.hp}/${player.maxHp} | Enemy: ${enemy.hp}/${enemy.maxHp} | Monete: ${player.coins}`;
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

  function flashHit(tx,ty){
    const x = tx*TILE + TILE/2, y = ty*TILE + TILE/2;
    ctx.save();
    ctx.globalAlpha = .25;
    ctx.fillStyle = '#ff0000';
    ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function getVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // --- Reset
  function resetAll(){
    for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) map[y][x]=0;
    genBlocks();
    player.x=1; player.y=1; player.hp=player.maxHp; player.coins=0;
    enemy.x=COLS-2; enemy.y=ROWS-2; enemy.hp=enemy.maxHp; enemy.tick=0;
    coins.length=0; for(let i=0;i<6;i++) coins.push(randEmpty());
    pathQueue.length=0;
    draw();
  }
  btnReset.addEventListener('click', resetAll);

  // --- Start loop
  draw();
  setInterval(step, 120);
})();
