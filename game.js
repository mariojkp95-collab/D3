/* ===== Barebones RPG – Step 4 FIX: chase throttled + mobile potion button — BUILD core3e =====
   Fix:
   - CHASE del nemico non più ogni frame: si muove a cadenza regolare (default ~260ms)
   - In chase il nemico non fa passi casuali: sceglie sempre il passo che riduce la distanza
   Mobile:
   - Bottone 🧪 sul canvas (in basso a destra) per usare la pozione anche da touch
   Mantiene: EXP/Level, cooldown attacco, hit-test click su nemico, monete/pozioni ecc.
*/
(() => {
  const BUILD = 'core3e';

  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const statusEl = document.getElementById('status');
  const btnReset = document.getElementById('btnReset');

  // Mappa
  const COLS = 15, ROWS = 9, TILE = 64;
  const map = Array.from({length:ROWS}, ()=>Array(COLS).fill(0));
  function genBlocks(){
    for(let i=0;i<22;i++){
      const x=Math.floor(Math.random()*COLS), y=Math.floor(Math.random()*ROWS);
      if((x===1 && y===1)||(x===COLS-2 && y===ROWS-2)) continue;
      map[y][x]=1;
    }
  }
  genBlocks();

  // Stato
  const player = {
    x:1,y:1,
    hp:100,maxHp:100,
    coins:0, pots:0,
    atkMin:6, atkMax:12,
    lastAtk:0, atkCd:400, // ms
    lvl:1, exp:0
  };
  const enemy  = {
    x:COLS-2,y:ROWS-2,
    hp:60,maxHp:60,
    tick:0,
    mode:'patrol', // 'patrol' | 'chase'
    lastHit:0, hitCd:800, // danno a contatto
    atkMin:5, atkMax:9,
    lastMove:0, moveCdChase:260, moveCdPatrol:600
  };
  const coins=[], potions=[];

  // spawn helpers
  function randEmpty(){
    for(let k=0;k<500;k++){
      const x=Math.floor(Math.random()*COLS), y=Math.floor(Math.random()*ROWS);
      const occupied = (x===player.x&&y===player.y) || (x===enemy.x&&y===enemy.y)
        || coins.some(c=>c.x===x&&c.y===y) || potions.some(p=>p.x===x&&p.y===y);
      if(map[y][x]===0 && !occupied) return {x,y};
    }
    return {x:2,y:2};
  }
  // iniziali
  for(let i=0;i<6;i++) coins.push(randEmpty());
  for(let i=0;i<2;i++) potions.push(randEmpty());

  // Utilità
  const inside=(x,y)=>x>=0&&y>=0&&x<COLS&&y<ROWS;
  const walkable=(x,y)=>inside(x,y)&&map[y][x]===0;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const manhattan=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const chebyshev=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
  const rndInt=(a,b)=>a+Math.floor(Math.random()*(b-a+1));
  const getVar=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  // EXP/Level
  const MAX_LVL=99, XP_COIN=2, XP_KILL=20;
  const xpNeeded=l=>Math.floor(50*Math.pow(l,1.5));
  function gainXP(n){
    if(player.lvl>=MAX_LVL) return;
    player.exp+=n;
    while(player.lvl<MAX_LVL && player.exp>=xpNeeded(player.lvl)){
      player.exp-=xpNeeded(player.lvl);
      levelUp();
    }
  }
  function levelUp(){
    player.lvl=Math.min(MAX_LVL,player.lvl+1);
    player.maxHp+=10; player.hp=player.maxHp;
    player.atkMin+=1; player.atkMax+=1;
    player.atkCd=Math.max(200,player.atkCd-20);
    // flash verde
    ctx.save(); ctx.globalAlpha=.25; ctx.fillStyle='#22c55e'; ctx.fillRect(0,0,cv.width,cv.height); ctx.restore();
  }

  // BFS
  function bfs(sx,sy,tx,ty){
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
        if(!walkable(nx,ny)||seen.has(kk)) continue;
        seen.add(kk); prev.set(kk,cur); q.push({x:nx, y:ny});
      }
    }
    return null;
  }

  // --- UI touch: bottone pozione su canvas ---
  const ui = {
    pot: { x: cv.width - 72, y: cv.height - 72, r: 28 } // centro + raggio
  };
  function pointInCircle(px,py,cx,cy,r){ const dx=px-cx, dy=py-cy; return dx*dx+dy*dy <= r*r; }

  // Input
  let pathQueue=[];
  function canvasToTile(ev){
    const r=cv.getBoundingClientRect();
    const sx=(ev.clientX-r.left)*(cv.width/r.width);
    const sy=(ev.clientY-r.top )*(cv.height/r.height);
    const tx=clamp(Math.floor(sx/TILE),0,COLS-1);
    const ty=clamp(Math.floor(sy/TILE),0,ROWS-1);
    return {sx,sy,tx,ty};
  }
  function enemyRect(){ const x=enemy.x*TILE+TILE/2-16, y=enemy.y*TILE+TILE/2-22; return {x,y,w:32,h:36}; }
  function inRect(px,py,r){ return px>=r.x&&px<=r.x+r.w&&py>=r.y&&py<=r.y+r.h; }

  function onPointer(ev){
    const {sx,sy,tx,ty}=canvasToTile(ev);
    // 1) bottone pozione (mobile)
    if(pointInCircle(sx,sy, ui.pot.x, ui.pot.y, ui.pot.r)){
      usePotion();
      return;
    }
    // 2) attacco (click su nemico + adiacente + cd pronto)
    const now=performance.now();
    const cdReady=(now-player.lastAtk)>=player.atkCd;
    const adj8=chebyshev(player,enemy)===1;
    const r=enemyRect();
    if(inRect(sx,sy,r)&&adj8&&cdReady){ attackEnemy(); return; }
    if(tx===enemy.x&&ty===enemy.y&&adj8&&cdReady){ attackEnemy(); return; }
    // 3) movimento
    const p=bfs(player.x,player.y,tx,ty); if(p&&p.length) pathQueue=p;
  }

  cv.addEventListener('click', onPointer);
  cv.addEventListener('touchstart', (e)=>{ if(e.touches && e.touches[0]) onPointer(e.touches[0]); }, {passive:true});

  // Attacco: SPAZIO (desktop)
  window.addEventListener('keydown',(e)=>{
    if(e.code==='Space'||e.key===' '){
      const now=performance.now();
      if(chebyshev(player,enemy)===1&&(now-player.lastAtk)>=player.atkCd) attackEnemy();
    }
    // Pozione: E (desktop)
    if(e.key==='e' || e.key==='E') usePotion();
  });

  btnReset.addEventListener('click', resetAll);

  // Combattimento
  function attackEnemy(){
    const now=performance.now(); player.lastAtk=now;
    const dmg=rndInt(player.atkMin,player.atkMax);
    enemy.hp=Math.max(0,enemy.hp-dmg);
    flashHit(enemy.x,enemy.y);
    if(enemy.hp===0){
      // drop: 70% moneta, 30% pozione
      if(Math.random()<0.7) coins.push({x:enemy.x,y:enemy.y});
      else potions.push({x:enemy.x,y:enemy.y});
      gainXP(XP_KILL);
      const spot=randEmpty(); enemy.x=spot.x; enemy.y=spot.y; enemy.hp=enemy.maxHp; enemy.mode='patrol'; enemy.lastMove=0;
    }
    draw();
  }

  // AI nemico (throttled)
  function enemyAI(){
    const dist=manhattan(enemy,player);
    if(dist<=6) enemy.mode='chase';
    else if(dist>=10) enemy.mode='patrol';

    const now = performance.now();

    if(enemy.mode==='chase'){
      if(now - enemy.lastMove >= enemy.moveCdChase){
        // scegli la mossa che riduce maggiormente la distanza
        const options=[
          {x:enemy.x+1,y:enemy.y},{x:enemy.x-1,y:enemy.y},
          {x:enemy.x,y:enemy.y+1},{x:enemy.x,y:enemy.y-1}
        ].filter(p=>walkable(p.x,p.y) && !(p.x===player.x && p.y===player.y));
        options.sort((a,b)=> manhattan(a,player) - manhattan(b,player));
        const best = options[0];
        if(best){ enemy.x=best.x; enemy.y=best.y; }
        enemy.lastMove = now;
      }
    } else { // patrol
      if(now - enemy.lastMove >= enemy.moveCdPatrol){
        const dirs=[[1,0],[-1,0],[0,1],[0,-1],[0,0]];
        const d = dirs[Math.floor(Math.random()*dirs.length)];
        const nx=enemy.x+d[0], ny=enemy.y+d[1];
        if(walkable(nx,ny) && !(nx===player.x && ny===player.y)){ enemy.x=nx; enemy.y=ny; }
        enemy.lastMove = now;
      }
    }
  }

  // Interazioni & oggetti
  function handleInteractions(){
    // monete (+XP)
    for(let i=coins.length-1;i>=0;i--){
      if(coins[i].x===player.x&&coins[i].y===player.y){
        coins.splice(i,1); player.coins++; gainXP(XP_COIN);
      }
    }
    // pozioni → inventario
    for(let i=potions.length-1;i>=0;i--){
      if(potions[i].x===player.x&&potions[i].y===player.y){
        potions.splice(i,1); player.pots++;
      }
    }
    // danno a contatto/adiacenza
    const touching=chebyshev(player,enemy)===0;
    const adjacent=chebyshev(player,enemy)===1;
    const now=performance.now();
    if((touching||adjacent)&&(now-enemy.lastHit)>=enemy.hitCd){
      enemy.lastHit=now;
      const dmg=rndInt(enemy.atkMin,enemy.atkMax);
      player.hp=Math.max(0,player.hp-dmg);
      flashHit(player.x,player.y);
      if(player.hp===0) gameOver();
    }
  }

  function usePotion(){
    if(player.pots<=0) return;
    if(player.hp>=player.maxHp) return; // niente sprechi
    player.pots--;
    player.hp = Math.min(player.maxHp, player.hp + 35);
    // flash viola tenue
    ctx.save(); ctx.globalAlpha=.20; ctx.fillStyle='#8b5cf6'; ctx.fillRect(0,0,cv.width,cv.height); ctx.restore();
    draw();
  }

  // Loop
  function step(){
    if(pathQueue.length){
      const next=pathQueue.shift();
      if(walkable(next.x,next.y) && !(next.x===enemy.x&&next.y===enemy.y)){
        player.x=next.x; player.y=next.y;
      }else pathQueue=[];
    }
    enemyAI();
    handleInteractions();
    draw();
  }

  // Draw
  function draw(){
    ctx.clearRect(0,0,cv.width,cv.height);
    // tiles
    for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++){
      ctx.fillStyle=(map[y][x]===1)?getVar('--block'):((x+y)%2===0?getVar('--tileA'):getVar('--tileB'));
      ctx.fillRect(x*TILE,y*TILE,TILE,TILE);
    }
    // coins
    ctx.fillStyle=getVar('--coin');
    for(const c of coins){
      const cx=c.x*TILE+TILE/2, cy=c.y*TILE+TILE/2;
      ctx.beginPath(); ctx.arc(cx,cy,10,0,Math.PI*2); ctx.fill();
    }
    // potions (boccetta viola)
    for(const p of potions){
      const x=p.x*TILE, y=p.y*TILE;
      ctx.fillStyle='#8b5cf6'; ctx.fillRect(x+TILE/2-8, y+TILE/2-14, 16, 20);
      ctx.fillStyle='#a78bfa'; ctx.fillRect(x+TILE/2-5, y+TILE/2-20, 10, 6);
      ctx.fillStyle='#6d28d9'; ctx.fillRect(x+TILE/2-6, y+TILE/2-24, 12, 4);
      ctx.fillStyle='#0006'; ctx.beginPath(); ctx.ellipse(x+TILE/2, y+TILE-12, 12, 4, 0, 0, Math.PI*2); ctx.fill();
    }
    // enemy
    drawActor(enemy.x,enemy.y,getVar('--enemy')); drawHpBar(enemy.x,enemy.y,enemy.hp,enemy.maxHp);
    // player
    drawActor(player.x,player.y,getVar('--player')); drawHpBar(player.x,player.y,player.hp,player.maxHp);
    // XP bar
    drawXpBar();
    // Bottone pozione (HUD mobile)
    drawPotionButton();
    // Banner build
    ctx.fillStyle='#ffffffcc'; ctx.font='bold 14px system-ui'; ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText('BUILD '+BUILD, 8, 8+12+12);

    // HUD debug
    const now=performance.now();
    const cdRemain=Math.max(0,player.atkCd-(now-player.lastAtk));
    const cdPct=Math.round(100*cdRemain/player.atkCd);
    const dist=manhattan(enemy,player);
    const need=player.lvl<MAX_LVL?xpNeeded(player.lvl):0;
    const xpPct=player.lvl<MAX_LVL?Math.floor(100*player.exp/need):100;
    statusEl.textContent=
      `build: ${BUILD} | LV ${player.lvl} | XP ${xpPct}% | CD ${cdRemain.toFixed(0)}ms (${cdPct}%) | enemy: ${enemy.mode} (dist=${dist}) | HP: ${player.hp}/${player.maxHp} | EHP: ${enemy.hp}/${enemy.maxHp} | coins: ${player.coins} | pots: ${player.pots}`;
  }

  function drawActor(tx,ty,color){
    const x=tx*TILE, y=ty*TILE;
    ctx.fillStyle=getVar('--shadow'); ctx.beginPath(); ctx.ellipse(x+TILE/2,y+TILE-12,18,6,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=color; ctx.fillRect(x+TILE/2-16, y+TILE/2-22, 32, 36);
  }
  function drawHpBar(tx,ty,hp,maxHp){
    const x=tx*TILE, y=ty*TILE, w=40, h=6, px=x+TILE/2-w/2, py=y+TILE/2-32;
    const r=Math.max(0,Math.min(1,hp/maxHp));
    ctx.fillStyle=getVar('--hpBack'); ctx.fillRect(px,py,w,h);
    ctx.fillStyle=getVar('--hp');     ctx.fillRect(px,py,w*r,h);
    ctx.strokeStyle='#0008'; ctx.strokeRect(px,py,w,h);
  }
  function drawXpBar(){
    const h=10,pad=6, x=pad,y=pad,w=cv.width-pad*2;
    const need=player.lvl<MAX_LVL?xpNeeded(player.lvl):1;
    const ratio=player.lvl<MAX_LVL?Math.max(0,Math.min(1,player.exp/need)):1;
    ctx.fillStyle='#0b1224aa'; ctx.fillRect(x,y,w,h);
    ctx.fillStyle='#7c3aed';   ctx.fillRect(x,y,w*ratio,h);
    ctx.strokeStyle='#1f2a44'; ctx.strokeRect(x,y,w,h);
    ctx.fillStyle='#e5e7eb'; ctx.font='12px system-ui'; ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText(`LV ${player.lvl}${player.lvl<MAX_LVL?` — ${Math.floor(ratio*100)}%`:''}`, x, y+h+2);
  }
  function drawPotionButton(){
    const {x,y,r}=ui.pot;
    // pulsante
    ctx.save();
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fillStyle = player.pots>0 && player.hp<player.maxHp ? '#1f2a44' : '#111827';
    ctx.fill();
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 2; ctx.stroke();
    // icona
    ctx.font='20px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#e5e7eb';
    ctx.fillText('🧪', x, y-2);
    // contatore
    ctx.font='12px system-ui'; ctx.fillText(String(player.pots), x, y+16);
    ctx.restore();
  }
  function flashHit(tx,ty){
    const x=tx*TILE+TILE/2, y=ty*TILE+TILE/2;
    ctx.save(); ctx.globalAlpha=.25; ctx.fillStyle='#ff0000'; ctx.beginPath(); ctx.arc(x,y,26,0,Math.PI*2); ctx.fill(); ctx.restore();
  }

  // Reset / Game Over
  function resetAll(){
    for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) map[y][x]=0;
    genBlocks();
    player.x=1;player.y=1;player.hp=player.maxHp=100;player.coins=0;player.pots=0;player.lastAtk=0;
    player.lvl=1; player.exp=0; player.atkMin=6; player.atkMax=12; player.atkCd=400;
    enemy.x=COLS-2;enemy.y=ROWS-2;enemy.hp=enemy.maxHp=60;enemy.tick=0;enemy.mode='patrol';enemy.lastHit=0; enemy.lastMove=0;
    coins.length=0; for(let i=0;i<6;i++) coins.push(randEmpty());
    potions.length=0; for(let i=0;i<2;i++) potions.push(randEmpty());
    pathQueue.length=0; draw();
  }
  function gameOver(){ alert('Sei stato sconfitto! Resetto la partita.'); resetAll(); }

  // Loop
  draw();
  setInterval(step,120);
})();
