/* ===== Barebones RPG — BUILD core3h =====
   Aggiunge: secondo nemico "ranged" con proiettili e line-of-sight.
   Mantiene: click-to-move, attacco+CD, melee aggro stabile, EXP/Lv, monete/pozioni, Save/Load/Reset, 🍵 mobile.
*/
(() => {
  const BUILD = 'core3h';
  const SAVE_KEY = 'barebones_save_v3';

  // DOM
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const statusEl = document.getElementById('status');
  const btnReset = document.getElementById('btnReset');
  const btnSave  = document.getElementById('btnSave');
  const btnLoad  = document.getElementById('btnLoad');
  const btnUsePotion = document.getElementById('btnUsePotion');

  // Mappa
  const COLS = 15, ROWS = 9, TILE = 64; // 960x576
  const map = Array.from({length:ROWS}, ()=>Array(COLS).fill(0));
  function genBlocks(){
    for(let i=0;i<22;i++){
      const x=Math.floor(Math.random()*COLS), y=Math.floor(Math.random()*ROWS);
      if((x===1 && y===1)||(x===COLS-2 && y===ROWS-2)) continue;
      map[y][x]=1;
    }
  }
  genBlocks();

  // Stato giocatore
  const player = {
    x:1,y:1,
    hp:100,maxHp:100,
    coins:0, pots:0,
    atkMin:6, atkMax:12,
    lastAtk:0, atkCd:400, // ms
    lvl:1, exp:0
  };

  // Nemici
  // - tipo 'melee' (uno già noto)
  // - tipo 'ranged' (nuovo) con tiro a distanza e kite
  const enemies = [];
  function spawnMelee(x,y){
    return {
      type:'melee',
      x,y, hp:60, maxHp:60,
      tick:0, mode:'patrol',
      lastHit:0, hitCd:800, atkMin:5, atkMax:9,
      moveTick:0, chaseEvery:2, patrolEvery:8
    };
  }
  function spawnRanged(x,y){
    return {
      type:'ranged',
      x,y, hp:40, maxHp:40,
      tick:0, mode:'patrol',
      atkCd:1200, lastShot:0, // spara ogni ~1.2s
      rangeMin:3, rangeMax:8, // preferisce distanza media
      kiteEvery:2, moveTick:0, patrolEvery:10
    };
  }

  // Oggetti
  const coins=[], potions=[];
  const projectiles=[]; // {x,y,dx,dy,spdTick,owner:'ranged', dmg}

  // Spawn helpers
  function randEmpty(){
    for(let k=0;k<800;k++){
      const x=Math.floor(Math.random()*COLS), y=Math.floor(Math.random()*ROWS);
      const occupied = (x===player.x&&y===player.y)
        || enemies.some(e=>e.x===x && e.y===y)
        || coins.some(c=>c.x===x&&c.y===y)
        || potions.some(p=>p.x===x&&p.y===y);
      if(map[y][x]===0 && !occupied) return {x,y};
    }
    return {x:2,y:2};
  }
  // iniziali
  for(let i=0;i<6;i++) coins.push(randEmpty());
  for(let i=0;i<2;i++) potions.push(randEmpty());
  // un melee e un ranged
  enemies.push(spawnMelee(COLS-2, ROWS-2));
  const spotR = randEmpty(); enemies.push(spawnRanged(spotR.x, spotR.y));

  // Utilità
  const inside=(x,y)=>x>=0&&y>=0&&x<COLS&&y<ROWS;
  const walkable=(x,y)=>inside(x,y)&&map[y][x]===0;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const manhattan=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const chebyshev=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
  const rndInt=(a,b)=>a+Math.floor(Math.random()*(b-a+1));
  const getVar=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  // EXP/Level
  const MAX_LVL=99, XP_COIN=2, XP_KILL_MELEE=20, XP_KILL_RANGED=25;
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

  // BFS pathfinding
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

  // Input
  let pathQueue=[];
  let lastTapTs=0;

  function canvasToTile(ev){
    const r=cv.getBoundingClientRect();
    const cx = (ev.clientX ?? ev.touches?.[0]?.clientX);
    const cy = (ev.clientY ?? ev.touches?.[0]?.clientY);
    const sx=(cx - r.left)*(cv.width/r.width);
    const sy=(cy - r.top )*(cv.height/r.height);
    const tx=clamp(Math.floor(sx/TILE),0,COLS-1);
    const ty=clamp(Math.floor(sy/TILE),0,ROWS-1);
    return {sx,sy,tx,ty};
  }

  // Hit-test nemico (rettangolo grafico su tile)
  function enemyRect(e){ const x=e.x*TILE+TILE/2-16, y=e.y*TILE+TILE/2-22; return {x,y,w:32,h:36}; }
  function inRect(px,py,r){ return px>=r.x&&px<=r.x+r.w&&py>=r.y&&py<=r.y+r.h; }

  // Click / tap to move or attack
  cv.addEventListener('click',(ev)=>{
    const {sx,sy,tx,ty}=canvasToTile(ev);
    const now=performance.now();
    const cdReady=(now-player.lastAtk)>=player.atkCd;
    // attacca se clicchi un nemico adiacente (8-dir)
    const adjEnemy = enemies.find(e => chebyshev(player,e)===1 && inRect(sx,sy,enemyRect(e)));
    if(adjEnemy && cdReady){ attackEnemy(adjEnemy); return; }
    if(cdReady){
      const onTileAdj = enemies.find(e => chebyshev(player,e)===1 && e.x===tx && e.y===ty);
      if(onTileAdj){ attackEnemy(onTileAdj); return; }
    }
    // movimento
    const p=bfs(player.x,player.y,tx,ty); if(p&&p.length) pathQueue=p;
  });

  // Double tap = use potion
  cv.addEventListener('pointerdown',(ev)=>{
    const now=performance.now();
    if(now - lastTapTs <= 300){ usePotion(); lastTapTs=0; }
    else { lastTapTs = now; }
  });

  // Keys
  window.addEventListener('keydown',(e)=>{
    if(e.code==='Space'||e.key===' '){
      const now=performance.now();
      const adj = enemies.find(en => chebyshev(player,en)===1);
      if(adj && (now-player.lastAtk)>=player.atkCd) attackEnemy(adj);
    }
    if(e.key==='e' || e.key==='E'){ usePotion(); }
  });

  // Floating button (mobile)
  if(btnUsePotion){
    btnUsePotion.addEventListener('click', usePotion);
    btnUsePotion.addEventListener('touchend', (e)=>{ e.preventDefault(); usePotion(); }, {passive:false});
  }

  // Buttons
  btnReset.addEventListener('click', resetAll);
  btnSave?.addEventListener('click', saveGame);
  btnLoad?.addEventListener('click', loadGame);

  // Combat
  function attackEnemy(target){
    const now=performance.now(); player.lastAtk=now;
    const dmg=rndInt(player.atkMin,player.atkMax);
    target.hp=Math.max(0,target.hp-dmg);
    flashHit(target.x,target.y);
    if(target.hp===0){
      // drop: 70% coin, 30% potion
      if(Math.random()<0.7) coins.push({x:target.x,y:target.y});
      else potions.push({x:target.x,y:target.y});
      gainXP(target.type==='ranged' ? XP_KILL_RANGED : XP_KILL_MELEE);
      // respawn stesso tipo altrove
      const idx = enemies.indexOf(target);
      enemies.splice(idx,1);
      const spot=randEmpty();
      enemies.push(target.type==='ranged' ? spawnRanged(spot.x,spot.y) : spawnMelee(spot.x,spot.y));
    }
    draw();
  }

  // Line of Sight (solo su righe/colonne: controlla blocchi in mezzo)
  function hasLoS(ax,ay,bx,by){
    if(ax===bx){
      const step = ay<by?1:-1;
      for(let y=ay+step; y!==by; y+=step){ if(map[y][ax]===1) return false; }
      return true;
    }
    if(ay===by){
      const step = ax<bx?1:-1;
      for(let x=ax+step; x!==bx; x+=step){ if(map[ay][x]===1) return false; }
      return true;
    }
    return false; // niente diagonali per LoS semplice
  }

  // Enemy AI (melee + ranged)
  function enemiesAI(){
    for(const e of enemies){
      if(e.type==='melee'){
        // aggro
        const dist = manhattan(e, player);
        if(dist<=6) e.mode='chase';
        else if(dist>=10) e.mode='patrol';
        // stop se adiacente (attacca da fermo)
        if(chebyshev(player,e)===1) continue;
        if(e.mode==='chase'){
          e.moveTick = (e.moveTick + 1) % e.chaseEvery;
          if(e.moveTick!==0) continue;
          const options = [
            {x:e.x+1,y:e.y},{x:e.x-1,y:e.y},{x:e.x,y:e.y+1},{x:e.x,y:e.y-1}
          ].filter(p=>walkable(p.x,p.y) && !(p.x===player.x && p.y===player.y));
          options.sort((a,b)=> manhattan(a,player)-manhattan(b,player));
          const best = options[0];
          if(best){ e.x=best.x; e.y=best.y; }
        } else {
          e.tick = (e.tick+1)%e.patrolEvery;
          if(e.tick===0){
            const dirs=[[1,0],[-1,0],[0,1],[0,-1],[0,0]];
            const d = dirs[Math.floor(Math.random()*dirs.length)];
            const nx=e.x+d[0], ny=e.y+d[1];
            if(walkable(nx,ny) && !(nx===player.x && ny===player.y)){ e.x=nx; e.y=ny; }
          }
        }
      } else if(e.type==='ranged'){
        const dist = manhattan(e, player);
        // semplice stato: in "aim" se ha LoS e dentro range; altrimenti si muove
        const inRange = dist>=e.rangeMin && dist<=e.rangeMax && hasLoS(e.x,e.y,player.x,player.y);
        if(inRange){
          // spara se CD pronto
          const now = performance.now();
          if(now - e.lastShot >= e.atkCd){
            e.lastShot = now;
            // direzione proiettile (rettilineo orizz/vert)
            let dx=0, dy=0;
            if(e.x===player.x) dy = player.y>e.y ? 1 : -1;
            else if(e.y===player.y) dx = player.x>e.x ? 1 : -1;
            if(dx!==0 || dy!==0){
              projectiles.push({x:e.x, y:e.y, dx, dy, spdTick:0, owner:'ranged', dmg:rndInt(6,10)});
            }
          }
          // se troppo vicino (< rangeMin) prova ad allontanarsi (kite)
          if(dist < e.rangeMin){
            e.moveTick = (e.moveTick+1)%e.kiteEvery;
            if(e.moveTick===0){
              // scegli la mossa che aumenta la distanza
              const options = [
                {x:e.x+1,y:e.y},{x:e.x-1,y:e.y},{x:e.x,y:e.y+1},{x:e.x,y:e.y-1},{x:e.x,y:e.y}
              ].filter(p=>walkable(p.x,p.y) && !(p.x===player.x && p.y===player.y));
              options.sort((a,b)=> manhattan(b,player)-manhattan(a,player)); // ordina per distanza decrescente
              const best = options[0];
              if(best){ e.x=best.x; e.y=best.y; }
            }
          }
        } else {
          // piccolo pattugliamento/avvicinamento grossolano verso riga/colonna
          e.tick = (e.tick+1)%e.patrolEvery;
          if(e.tick===0){
            // preferisci muoverti verso stessa riga o colonna, evitando muri
            const dx = Math.sign(player.x - e.x), dy = Math.sign(player.y - e.y);
            const opts = [];
            if(dx!==0) opts.push({x:e.x+dx,y:e.y});
            if(dy!==0) opts.push({x:e.x,y:e.y+dy});
            opts.push({x:e.x,y:e.y}); // o resta
            const move = opts.find(p=>walkable(p.x,p.y) && !(p.x===player.x && p.y===player.y));
            if(move){ e.x=move.x; e.y=move.y; }
          }
        }
      }
    }
  }

  // Proiettili update
  function updateProjectiles(){
    for(let i=projectiles.length-1;i>=0;i--){
      const pr = projectiles[i];
      // velocità: 1 cella ogni 2 frame per leggibilità
      pr.spdTick = (pr.spdTick+1)%2;
      if(pr.spdTick!==0) continue;
      const nx = pr.x + pr.dx;
      const ny = pr.y + pr.dy;
      if(!inside(nx,ny) || map[ny][nx]===1){
        projectiles.splice(i,1); continue;
      }
      // colpisce player?
      if(nx===player.x && ny===player.y){
        player.hp = Math.max(0, player.hp - pr.dmg);
        flashHit(player.x,player.y);
        projectiles.splice(i,1);
        if(player.hp===0) gameOver();
        continue;
      }
      pr.x=nx; pr.y=ny;
    }
  }

  // Interactions & items
  function handleInteractions(){
    // movimento player 1 step/frame
    if(pathQueue.length){
      const next=pathQueue.shift();
      // evita occupare tile nemici
      if(walkable(next.x,next.y) && !enemies.some(e=>e.x===next.x&&e.y===next.y)){
        player.x=next.x; player.y=next.y;
      } else pathQueue=[];
    }

    // coins (+XP)
    for(let i=coins.length-1;i>=0;i--){
      if(coins[i].x===player.x&&coins[i].y===player.y){
        coins.splice(i,1); player.coins++; gainXP(XP_COIN);
      }
    }
    // potions → inventory
    for(let i=potions.length-1;i>=0;i--){
      if(potions[i].x===player.x&&potions[i].y===player.y){
        potions.splice(i,1); player.pots++;
      }
    }
    // melee contact damage (adiacente o stessa tile)
    const now=performance.now();
    for(const e of enemies){
      if(e.type!=='melee') continue;
      const touching=chebyshev(player,e)===0;
      const adjacent=chebyshev(player,e)===1;
      if((touching||adjacent) && (now - e.lastHit) >= e.hitCd){
        e.lastHit = now;
        const dmg=rndInt(e.atkMin,e.atkMax);
        player.hp = Math.max(0, player.hp - dmg);
        flashHit(player.x,player.y);
        if(player.hp===0) gameOver();
      }
    }
  }

  function usePotion(){
    if(player.pots<=0) return;
    if(player.hp>=player.maxHp) return;
    player.pots--;
    player.hp = Math.min(player.maxHp, player.hp + 35);
    // flash viola
    ctx.save(); ctx.globalAlpha=.20; ctx.fillStyle='#8b5cf6'; ctx.fillRect(0,0,cv.width,cv.height); ctx.restore();
    draw();
  }

  // Save / Load (includiamo enemies e NON salviamo i proiettili per semplicità)
  function saveGame(){
    try{
      const data = {
        build: BUILD,
        map,
        player,
        enemies,
        coins,
        potions
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      toast('Salvataggio completato.');
    }catch(e){ console.error(e); alert('Errore nel salvataggio.'); }
  }
  function loadGame(){
    try{
      const raw = localStorage.getItem(SAVE_KEY);
      if(!raw) return alert('Nessun salvataggio trovato.');
      const data = JSON.parse(raw);
      if(Array.isArray(data.map) && data.map.length===ROWS){
        for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) map[y][x]=data.map[y][x]|0;
      }
      Object.assign(player, data.player || {});
      enemies.length=0;
      (data.enemies||[]).forEach(e=>{
        // ripristina tipo e default mancanti
        if(e.type==='ranged') enemies.push(Object.assign(spawnRanged(e.x|0, e.y|0), e));
        else enemies.push(Object.assign(spawnMelee(e.x|0, e.y|0), e));
      });
      coins.length=0; (data.coins||[]).forEach(c=>coins.push({x:c.x|0, y:c.y|0}));
      potions.length=0; (data.potions||[]).forEach(p=>potions.push({x:p.x|0, y:p.y|0}));
      projectiles.length=0; // non persistiamo
      draw(); toast('Caricamento completato.');
    }catch(e){ console.error(e); alert('Salvataggio corrotto o non valido.'); }
  }
  function toast(msg){
    statusEl.textContent = `[${BUILD}] ${msg}`;
    setTimeout(()=>updateStatus(), 900);
  }

  // Loop
  function step(){
    enemiesAI();
    updateProjectiles();
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
    // enemies
    for(const e of enemies){
      if(e.type==='ranged'){
        drawActor(e.x,e.y,'#a855f7'); // viola per il ranged
      }else{
        drawActor(e.x,e.y,getVar('--enemy')); // rosso per melee
      }
      drawHpBar(e.x,e.y,e.hp,e.maxHp);
    }
    // player
    drawActor(player.x,player.y,getVar('--player')); drawHpBar(player.x,player.y,player.hp,player.maxHp);
    // projectiles
    for(const pr of projectiles){
      const x=pr.x*TILE+TILE/2, y=pr.y*TILE+TILE/2;
      ctx.fillStyle='#f87171'; // rosso chiaro
      ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fill();
    }
    // XP bar
    drawXpBar();
    // Build banner
    ctx.fillStyle='#ffffffcc'; ctx.font='bold 14px system-ui'; ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText('BUILD '+BUILD, 8, 8+12+12);
    updateStatus();
  }

  function updateStatus(){
    const now=performance.now();
    const cdRemain=Math.max(0,player.atkCd-(now-player.lastAtk));
    const cdPct=Math.round(100*cdRemain/player.atkCd);
    const nearest = enemies.reduce((m,e)=>Math.min(m, manhattan(e,player)), 999);
    const need=player.lvl<MAX_LVL?xpNeeded(player.lvl):0;
    const xpPct=player.lvl<MAX_LVL?Math.floor(100*player.exp/need):100;
    statusEl.textContent=
      `build: ${BUILD} | LV ${player.lvl} | XP ${xpPct}% | CD ${cdRemain.toFixed(0)}ms (${cdPct}%) | enemies: ${enemies.length} (nearest=${nearest}) | HP: ${player.hp}/${player.maxHp} | coins: ${player.coins} | pots: ${player.pots}`;
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
    enemies.length=0;
    enemies.push(spawnMelee(COLS-2, ROWS-2));
    const sr=randEmpty(); enemies.push(spawnRanged(sr.x,sr.y));
    coins.length=0; for(let i=0;i<6;i++) coins.push(randEmpty());
    potions.length=0; for(let i=0;i<2;i++) potions.push(randEmpty());
    projectiles.length=0;
    pathQueue.length=0; draw();
  }
  function gameOver(){ alert('Sei stato sconfitto! Resetto la partita.'); resetAll(); }

  // Save/Load helpers
  function saveGame(){
    try{
      const data = {build:BUILD, map, player, enemies, coins, potions};
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      toast('Salvataggio completato.');
    }catch(e){ console.error(e); alert('Errore nel salvataggio.'); }
  }
  function loadGame(){
    try{
      const raw = localStorage.getItem(SAVE_KEY);
      if(!raw) return alert('Nessun salvataggio trovato.');
      const data = JSON.parse(raw);
      if(Array.isArray(data.map) && data.map.length===ROWS){
        for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) map[y][x]=data.map[y][x]|0;
      }
      Object.assign(player, data.player || {});
      enemies.length=0;
      (data.enemies||[]).forEach(e=>{
        if(e.type==='ranged') enemies.push(Object.assign(spawnRanged(e.x|0,e.y|0), e));
        else enemies.push(Object.assign(spawnMelee(e.x|0,e.y|0), e));
      });
      coins.length=0; (data.coins||[]).forEach(c=>coins.push({x:c.x|0, y:c.y|0}));
      potions.length=0; (data.potions||[]).forEach(p=>potions.push({x:p.x|0, y:p.y|0}));
      projectiles.length=0;
      draw(); toast('Caricamento completato.');
    }catch(e){ console.error(e); alert('Salvataggio corrotto o non valido.'); }
  }
  function toast(msg){
    statusEl.textContent = `[${BUILD}] ${msg}`;
    setTimeout(()=>updateStatus(), 900);
  }

  // Start
  draw();
  setInterval(step,120);
})();
