/* ===== Barebones RPG – Step 5: Save/Load — BUILD core3f =====
   - Pulsanti: Save / Load
   - Persistenza su localStorage (mappa, player, enemy, coins, potions)
   - Mantiene tutte le funzioni di core3e (aggro fix + mobile potions)
*/
(() => {
  const BUILD = 'core3f';
  const SAVE_KEY = 'barebones_save_v3';

  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const statusEl = document.getElementById('status');
  const btnReset = document.getElementById('btnReset');
  const btnSave  = document.getElementById('btnSave');
  const btnLoad  = document.getElementById('btnLoad');
  const btnUsePotion = document.getElementById('btnUsePotion');

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
    moveTick:0,
    chaseEvery:2,  // 1 step ogni 2 frame (~240ms)
    patrolEvery:8
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

  // Input (click / doppio-tap / tasti)
  let pathQueue=[];
  let lastTapTs=0;
  function canvasToTile(ev){
    const r=cv.getBoundingClientRect();
    const sx=( (ev.clientX ?? ev.touches?.[0]?.clientX) - r.left)*(cv.width/r.width);
    const sy=( (ev.clientY ?? ev.touches?.[0]?.clientY) - r.top )*(cv.height/r.height);
    const tx=clamp(Math.floor(sx/TILE),0,COLS-1);
    const ty=clamp(Math.floor(sy/TILE),0,ROWS-1);
    return {sx,sy,tx,ty};
  }
  function enemyRect(){ const x=enemy.x*TILE+TILE/2-16, y=enemy.y*TILE+TILE/2-22; return {x,y,w:32,h:36}; }
  function inRect(px,py,r){ return px>=r.x&&px<=r.x+r.w&&py>=r.y&&py<=r.y+r.h; }

  // Click / tap
  cv.addEventListener('click',(ev)=>{
    const {sx,sy,tx,ty}=canvasToTile(ev);
    const now=performance.now();
    const cdReady=(now-player.lastAtk)>=player.atkCd;
    const adj8=chebyshev(player,enemy)===1;

    const r=enemyRect();
    if(inRect(sx,sy,r)&&adj8&&cdReady){ attackEnemy(); return; }
    if(tx===enemy.x&&ty===enemy.y&&adj8&&cdReady){ attackEnemy(); return; }

    const p=bfs(player.x,player.y,tx,ty); if(p&&p.length) pathQueue=p;
  });

  // Doppio-tap per usare pozione
  cv.addEventListener('pointerdown',(ev)=>{
    const now=performance.now();
    if(now - lastTapTs <= 300){ usePotion(); lastTapTs=0; }
    else { lastTapTs = now; }
  });

  // Tasti
  window.addEventListener('keydown',(e)=>{
    if(e.code==='Space'||e.key===' '){
      const now=performance.now();
      if(chebyshev(player,enemy)===1&&(now-player.lastAtk)>=player.atkCd) attackEnemy();
    }
    if(e.key==='e' || e.key==='E'){ usePotion(); }
  });

  // Bottone flottante (mobile)
  if(btnUsePotion){
    btnUsePotion.addEventListener('click', usePotion);
    btnUsePotion.addEventListener('touchend', (e)=>{ e.preventDefault(); usePotion(); }, {passive:false});
  }

  btnReset.addEventListener('click', resetAll);
  if(btnSave) btnSave.addEventListener('click', saveGame);
  if(btnLoad) btnLoad.addEventListener('click', loadGame);

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
      const spot=randEmpty(); enemy.x=spot.x; enemy.y=spot.y; enemy.hp=enemy.maxHp; enemy.mode='patrol';
    }
    draw();
  }

  // AI nemico (pacing e stop adiacente)
  function enemyAI(){
    const dist = manhattan(enemy, player);
    if(dist<=6) enemy.mode='chase';
    else if(dist>=10) enemy.mode='patrol';

    const adj8 = chebyshev(player, enemy)===1;
    if(adj8){ return; } // adiacente: resta fermo e attacca

    if(enemy.mode==='chase'){
      enemy.moveTick = (enemy.moveTick + 1) % enemy.chaseEvery;
      if(enemy.moveTick!==0) return; // rallenta
      const options = [
        {x:enemy.x+1,y:enemy.y},{x:enemy.x-1,y:enemy.y},
        {x:enemy.x,y:enemy.y+1},{x:enemy.x,y:enemy.y-1}
      ].filter(p=>walkable(p.x,p.y) && !(p.x===player.x && p.y===player.y));
      options.sort((a,b)=> manhattan(a,player)-manhattan(b,player));
      const best = options[0];
      if(best){ enemy.x=best.x; enemy.y=best.y; }
    } else {
      enemy.tick = (enemy.tick+1)%enemy.patrolEvery;
      if(enemy.tick===0){
        const dirs=[[1,0],[-1,0],[0,1],[0,-1],[0,0]];
        const d = dirs[Math.floor(Math.random()*dirs.length)];
        const nx=enemy.x+d[0], ny=enemy.y+d[1];
        if(walkable(nx,ny) && !(nx===player.x && ny===player.y)){ enemy.x=nx; enemy.y=ny; }
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
    if(player.hp>=player.maxHp) return;
    player.pots--;
    player.hp = Math.min(player.maxHp, player.hp + 35);
    // flash viola tenue
    ctx.save(); ctx.globalAlpha=.20; ctx.fillStyle='#8b5cf6'; ctx.fillRect(0,0,cv.width,cv.height); ctx.restore();
    draw();
  }

  // Save / Load
  function saveGame(){
    try{
      const data = {
        build: BUILD,
        map,
        player,
        enemy,
        coins,
        potions
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      toast('Salvataggio completato.');
    }catch(e){
      console.error(e);
      alert('Errore nel salvataggio.');
    }
  }
  function loadGame(){
    try{
      const raw = localStorage.getItem(SAVE_KEY);
      if(!raw) return alert('Nessun salvataggio trovato.');
      const data = JSON.parse(raw);
      // ripristino sicuro con fallback
      if(Array.isArray(data.map) && data.map.length===ROWS){
        for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) map[y][x]=data.map[y][x]|0;
      }
      Object.assign(player, data.player || {});
      Object.assign(enemy,  data.enemy  || {});
      coins.length=0; (data.coins||[]).forEach(c=>coins.push({x:c.x|0, y:c.y|0}));
      potions.length=0; (data.potions||[]).forEach(p=>potions.push({x:p.x|0, y:p.y|0}));
      // normalizza alcuni campi che potrebbero mancare
      enemy.moveTick = enemy.moveTick|0;
      enemy.chaseEvery = enemy.chaseEvery||2;
      enemy.patrolEvery = enemy.patrolEvery||8;
      player.lastAtk = player.lastAtk||0;
      draw();
      toast('Caricamento completato.');
    }catch(e){
      console.error(e);
      alert('Salvataggio corrotto o non valido.');
    }
  }

  function toast(msg){
    // mini toast testuale in status (senza CSS extra)
    statusEl.textContent = `[${BUILD}] ${msg}`;
    setTimeout(()=>updateStatus(), 800);
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
    // potions
    for(const p of potions){
      const x=p.x*TILE, y=p.y*TILE;
      ctx.fillStyle='#8b5cf6'; ctx.fillRect(x + TILE/2 - 8, y + TILE/2 - 14, 16, 20);
      ctx.fillStyle='#a78bfa'; ctx.fillRect(x + TILE/2 - 5, y + TILE/2 - 20, 10, 6);
      ctx.fillStyle='#6d28d9'; ctx.fillRect(x + TILE/2 - 6, y + TILE/2 - 24, 12, 4);
      ctx.fillStyle='#0006'; ctx.beginPath(); ctx.ellipse(x+TILE/2, y+TILE-12, 12, 4, 0, 0, Math.PI*2); ctx.fill();
    }
    // enemy
    drawActor(enemy.x,enemy.y,getVar('--enemy')); drawHpBar(enemy.x,enemy.y,enemy.hp,enemy.maxHp);
    // player
    drawActor(player.x,player.y,getVar('--player')); drawHpBar(player.x,player.y,player.hp,player.maxHp);
    // XP bar
    drawXpBar();
    // Banner build
    ctx.fillStyle='#ffffffcc'; ctx.font='bold 14px system-ui'; ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText('BUILD '+BUILD, 8, 8+12+12);

    updateStatus();
  }

  function updateStatus(){
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
    enemy.x=COLS-2;enemy.y=ROWS-2;enemy.hp=enemy.maxHp=60;enemy.tick=0;enemy.mode='patrol';enemy.lastHit=0;enemy.moveTick=0;
    coins.length=0; for(let i=0;i<6;i++) coins.push(randEmpty());
    potions.length=0; for(let i=0;i<2;i++) potions.push(randEmpty());
    pathQueue.length=0; draw();
  }
  function gameOver(){ alert('Sei stato sconfitto! Resetto la partita.'); resetAll(); }

  // Avvio
  draw();
  setInterval(step,120);
})();
