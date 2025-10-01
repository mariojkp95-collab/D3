/* ===== Barebones RPG — BUILD core3j =====
   Aggiunge: SISTEMA DI QUEST (UI + progressi + ricompense, persistente)
   Mantiene: tutto da core3i (respawn morbido, melee+ranged, proiettili, pozioni 🍵, XP/Lv, Save/Load).
*/
(() => {
  const BUILD = 'core3j';
  const SAVE_KEY = 'barebones_save_v3';
  const QUEST_KEY = 'barebones_quests_v1';

  // DOM
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const statusEl = document.getElementById('status');
  const btnReset = document.getElementById('btnReset');
  const btnSave  = document.getElementById('btnSave');
  const btnLoad  = document.getElementById('btnLoad');
  const btnUsePotion = document.getElementById('btnUsePotion');
  const btnQuest = document.getElementById('btnQuest');
  const questPanel = document.getElementById('questPanel');
  const questBody = document.getElementById('questBody');
  const btnQuestClose = document.getElementById('btnQuestClose');

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

  // Giocatore
  const player = {
    x:1,y:1,
    hp:100,maxHp:100,
    coins:0, pots:0,
    atkMin:6, atkMax:12,
    lastAtk:0, atkCd:400, // ms
    lvl:1, exp:0
  };

  // Nemici
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
      atkCd:1200, lastShot:0,
      rangeMin:3, rangeMax:8,
      kiteEvery:2, moveTick:0, patrolEvery:10,
      pokeCd:700, lastPoke:0
    };
  }

  // Oggetti e proiettili
  const coins=[], potions=[], projectiles=[];

  // Spawn helper
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
  // spawn iniziale
  for(let i=0;i<6;i++) coins.push(randEmpty());
  for(let i=0;i<2;i++) potions.push(randEmpty());
  enemies.push(spawnMelee(COLS-2, ROWS-2));
  { const s = randEmpty(); enemies.push(spawnRanged(s.x, s.y)); }

  // Utilità base
  const inside=(x,y)=>x>=0&&y>=0&&x<COLS&&y<ROWS;
  const walkable=(x,y)=>inside(x,y)&&map[y][x]===0;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const manhattan=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
  const chebyshev=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
  const rndInt=(a,b)=>a+Math.floor(Math.random()*(b-a+1));
  const getVar=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  // EXP / Level
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

  // ===== QUEST SYSTEM =====
  // stato quest: {id, title, desc, type, target, needed, progress, status: 'active'|'completed'|'claimed', reward:{xp,coins,pots}}
  const quests = [
    { id:'q1', title:'Raccogli 10 monete', desc:'Trova e raccogli 10 monete sparse nella mappa.',
      type:'collect', target:'coins', needed:10, progress:0, status:'active',
      reward:{xp:50, pots:1} },
    { id:'q2', title:'Sconfiggi 3 nemici', desc:'Elimina qualsiasi combinazione di nemici.',
      type:'kill', target:'any', needed:3, progress:0, status:'locked',
      reward:{xp:80, coins:3} },
  ];
  let currentQuest = 0; // indice nell’array

  function questCanAdvance(q){
    if(q.status!=='active') return false;
    return q.progress < q.needed;
  }
  function questAddProgress(kind, amount=1){
    const q = quests[currentQuest];
    if(!q || q.status!=='active') return;
    if(q.type==='collect' && kind==='coin'){
      q.progress = Math.min(q.needed, q.progress + amount);
    } else if(q.type==='kill' && (kind==='kill_any' || (kind==='kill_ranged'&&q.target!=='melee') || (kind==='kill_melee'&&q.target!=='ranged'))){
      q.progress = Math.min(q.needed, q.progress + amount);
    }
    if(q.progress >= q.needed){
      q.status = 'completed';
      toast('Quest completata! Riscatta la ricompensa.');
    }
    renderQuest();
  }
  function claimQuest(){
    const q = quests[currentQuest];
    if(!q || q.status!=='completed') return;
    const rw = q.reward||{};
    if(rw.xp) gainXP(rw.xp);
    if(rw.coins) player.coins += rw.coins;
    if(rw.pots) player.pots += rw.pots;
    q.status = 'claimed';
    // sblocca la prossima, se esiste
    if(currentQuest+1 < quests.length){
      currentQuest++;
      const nq = quests[currentQuest];
      if(nq.status==='locked') nq.status='active';
      toast('Nuova quest disponibile!');
    } else {
      toast('Hai completato tutte le quest disponibili.');
    }
    renderQuest();
  }

  // UI quest
  function renderQuest(){
    const q = quests[currentQuest];
    if(!q){ questBody.innerHTML = '<div class="q-title">Nessuna quest</div>'; return; }
    const ratio = q.needed>0 ? Math.floor(100*(q.progress/q.needed)) : 100;
    const rw = q.reward||{};
    const btnDisabled = q.status!=='completed';
    questBody.innerHTML = `
      <div class="q-title">${q.title}</div>
      <div class="q-desc">${q.desc}</div>
      <div class="q-row">
        <div class="progress"><div style="width:${ratio}%"></div></div>
        <div style="margin-left:8px">${q.progress}/${q.needed}</div>
      </div>
      <div class="q-reward">Ricompensa: ${rw.xp?`+${rw.xp} XP `:''}${rw.coins?`· +${rw.coins} monete `:''}${rw.pots?`· +${rw.pots} pozione/i`:''}</div>
      <button id="btnClaim" class="q-claim" ${btnDisabled?'disabled':''}>Riscatta</button>
    `;
    const btnClaim = document.getElementById('btnClaim');
    if(btnClaim) btnClaim.onclick = claimQuest;
  }
  function toggleQuestPanel(forceOpen){
    const open = typeof forceOpen==='boolean' ? forceOpen : questPanel.classList.contains('hidden');
    if(open){ questPanel.classList.remove('hidden'); renderQuest(); }
    else { questPanel.classList.add('hidden'); }
  }

  btnQuest?.addEventListener('click', ()=>toggleQuestPanel());
  btnQuestClose?.addEventListener('click', ()=>toggleQuestPanel(false));

  // BFS (pathfinding)
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
  let pathQueue=[], lastTapTs=0;

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

  function enemyRect(e){ const x=e.x*TILE+TILE/2-16, y=e.y*TILE+TILE/2-22; return {x,y,w:32,h:36}; }
  function inRect(px,py,r){ return px>=r.x&&px<=r.x+r.w&&py>=r.y&&py<=r.y+r.h; }

  // Click / tap to move or attack
  cv.addEventListener('click',(ev)=>{
    const {sx,sy,tx,ty}=canvasToTile(ev);
    const now=performance.now();
    const cdReady=(now-player.lastAtk)>=player.atkCd;
    const adjEnemy = enemies.find(e => chebyshev(player,e)===1 && inRect(sx,sy,enemyRect(e)));
    if(adjEnemy && cdReady){ attackEnemy(adjEnemy); return; }
    if(cdReady){
      const onTileAdj = enemies.find(e => chebyshev(player,e)===1 && e.x===tx && e.y===ty);
      if(onTileAdj){ attackEnemy(onTileAdj); return; }
    }
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

  // Floating button
  if(btnUsePotion){
    btnUsePotion.addEventListener('click', usePotion);
    btnUsePotion.addEventListener('touchend', (e)=>{ e.preventDefault(); usePotion(); }, {passive:false});
  }

  // Buttons
  btnReset.addEventListener('click', hardReset);
  btnSave?.addEventListener('click', saveAll);
  btnLoad?.addEventListener('click', loadAll);

  // Combat (player → enemy)
  function attackEnemy(target){
    const now=performance.now(); player.lastAtk=now;
    const dmg=rndInt(player.atkMin,player.atkMax);
    target.hp=Math.max(0,target.hp-dmg);
    flashHit(target.x,target.y);
    if(target.hp===0){
      if(Math.random()<0.7) coins.push({x:target.x,y:target.y});
      else potions.push({x:target.x,y:target.y});
      questAddProgress(target.type==='ranged' ? 'kill_ranged' : 'kill_melee', 1);
      gainXP(target.type==='ranged' ? XP_KILL_RANGED : XP_KILL_MELEE);
      const idx = enemies.indexOf(target);
      enemies.splice(idx,1);
      const s=randEmpty();
      enemies.push(target.type==='ranged' ? spawnRanged(s.x,s.y) : spawnMelee(s.x,s.y));
    }
    draw();
  }

  // Line of Sight (ortogonale)
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
    return false;
  }

  // Enemy AI
  function enemiesAI(){
    for(const e of enemies){
      if(e.type==='melee'){
        const dist = manhattan(e, player);
        if(dist<=6) e.mode='chase';
        else if(dist>=10) e.mode='patrol';
        if(chebyshev(player,e)===1) continue; // stop adiacente
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
        const distM = manhattan(e, player);
        const adj8 = chebyshev(e, player)===1;

        // poke ravvicinato
        if(adj8){
          const now = performance.now();
          if(now - e.lastPoke >= e.pokeCd){
            e.lastPoke = now;
            const dmg = rndInt(5,9);
            player.hp = Math.max(0, player.hp - dmg);
            flashHit(player.x,player.y);
            if(player.hp===0) gameOver();
          }
          continue;
        }

        const inRange = distM>=e.rangeMin && distM<=e.rangeMax && hasLoS(e.x,e.y,player.x,player.y);
        if(inRange){
          const now = performance.now();
          if(now - e.lastShot >= e.atkCd){
            e.lastShot = now;
            let dx=0, dy=0;
            if(e.x===player.x) dy = player.y>e.y ? 1 : -1;
            else if(e.y===player.y) dx = player.x>e.x ? 1 : -1;
            if(dx!==0 || dy!==0){
              projectiles.push({x:e.x, y:e.y, dx, dy, spdTick:0, owner:'ranged', dmg:rndInt(6,10)});
            }
          }
          if(distM < e.rangeMin){
            e.moveTick = (e.moveTick+1)%e.kiteEvery;
            if(e.moveTick===0){
              const options = [
                {x:e.x+1,y:e.y},{x:e.x-1,y:e.y},{x:e.x,y:e.y+1},{x:e.x,y:e.y-1},{x:e.x,y:e.y}
              ].filter(p=>walkable(p.x,p.y) && !(p.x===player.x && p.y===player.y));
              options.sort((a,b)=> manhattan(b,player)-manhattan(a,player));
              const best = options[0];
              if(best){ e.x=best.x; e.y=best.y; }
            }
          }
        } else {
          e.tick = (e.tick+1)%e.patrolEvery;
          if(e.tick===0){
            const dx = Math.sign(player.x - e.x), dy = Math.sign(player.y - e.y);
            const opts = [];
            if(dx!==0) opts.push({x:e.x+dx,y:e.y});
            if(dy!==0) opts.push({x:e.x,y:e.y+dy});
            opts.push({x:e.x,y:e.y});
            const move = opts.find(p=>walkable(p.x,p.y) && !(p.x===player.x && p.y===player.y));
            if(move){ e.x=move.x; e.y=move.y; }
          }
        }
      }
    }
  }

  // Proiettili
  function updateProjectiles(){
    for(let i=projectiles.length-1;i>=0;i--){
      const pr = projectiles[i];
      pr.spdTick = (pr.spdTick+1)%2;
      if(pr.spdTick!==0) continue;
      const nx = pr.x + pr.dx, ny = pr.y + pr.dy;
      if(!inside(nx,ny) || map[ny][nx]===1){
        projectiles.splice(i,1); continue;
      }
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

  // Interazioni & items
  function handleInteractions(){
    // movimento player 1 step/frame evitando i nemici
    if(pathQueue.length){
      const next=pathQueue.shift();
      if(walkable(next.x,next.y) && !enemies.some(e=>e.x===next.x&&e.y===next.y)){
        player.x=next.x; player.y=next.y;
      } else pathQueue=[];
    }
    // coins (+XP + quest)
    for(let i=coins.length-1;i>=0;i--){
      if(coins[i].x===player.x&&coins[i].y===player.y){
        coins.splice(i,1); player.coins++; gainXP(XP_COIN);
        questAddProgress('coin', 1);
      }
    }
    // potions
    for(let i=potions.length-1;i>=0;i--){
      if(potions[i].x===player.x&&potions[i].y===player.y){
        potions.splice(i,1); player.pots++;
      }
    }
    // melee contact damage
    const now=performance.now();
    for(const e of enemies){
      if(e.type!=='melee') continue;
      const touching=chebyshev(player,e)===0;
      const adjacent=chebyshev(player,e)===1;
      if((touching||adjacent) && (now - e.lastHit) >= e.hitCd){
        e.lastHit=now;
        const dmg=rndInt(e.atkMin,e.atkMax);
        player.hp=Math.max(0,player.hp-dmg);
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
    ctx.save(); ctx.globalAlpha=.20; ctx.fillStyle='#8b5cf6'; ctx.fillRect(0,0,cv.width,cv.height); ctx.restore();
    draw();
  }

  // ===== Persistenza =====
  function saveCore(){
    return {
      build: BUILD, map, player, enemies, coins, potions
    };
  }
  function loadCore(data){
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
  }
  function saveQuests(){
    return { currentQuest, quests };
  }
  function loadQuests(qdata){
    if(!qdata) return;
    currentQuest = Math.min(qdata.currentQuest|0, quests.length-1);
    if(Array.isArray(qdata.quests)){
      // aggiorna progressi e stati compatibilmente con la definizione attuale
      for(let i=0;i<quests.length && i<qdata.quests.length;i++){
        const src = qdata.quests[i];
        quests[i].progress = src.progress|0;
        quests[i].status = src.status||quests[i].status;
      }
    }
  }

  function saveAll(){
    try{
      localStorage.setItem(SAVE_KEY, JSON.stringify(saveCore()));
      localStorage.setItem(QUEST_KEY, JSON.stringify(saveQuests()));
      toast('Salvataggio completato.');
    }catch(e){ console.error(e); alert('Errore nel salvataggio.'); }
  }
  function loadAll(){
    try{
      const raw = localStorage.getItem(SAVE_KEY);
      if(!raw) return alert('Nessun salvataggio trovato.');
      loadCore(JSON.parse(raw));
      const qr = localStorage.getItem(QUEST_KEY);
      if(qr) loadQuests(JSON.parse(qr));
      draw(); toast('Caricamento completato.');
      renderQuest();
    }catch(e){ console.error(e); alert('Salvataggio corrotto o non valido.'); }
  }

  // Toast helper
  function toast(msg){
    statusEl.textContent = `[${BUILD}] ${msg}`;
    setTimeout(()=>updateStatus(), 900);
  }

  // Respawn morbido (come core3i)
  function softRespawn(){
    player.hp = player.maxHp;
    player.x = 1; player.y = 1;
    projectiles.length = 0;
    for(let i=0;i<enemies.length;i++){
      const s = randEmpty();
      enemies[i].x = s.x; enemies[i].y = s.y;
      if(enemies[i].type==='ranged'){ enemies[i].lastShot = 0; enemies[i].lastPoke = 0; }
      if(enemies[i].type==='melee'){ enemies[i].lastHit = 0; }
    }
    pathQueue.length = 0;
    draw();
  }

  // Reset completo (tutto da zero)
  function hardReset(){
    for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) map[y][x]=0;
    genBlocks();
    player.x=1;player.y=1;player.hp=player.maxHp=100;player.coins=0;player.pots=0;player.lastAtk=0;
    player.lvl=1; player.exp=0; player.atkMin=6; player.atkMax=12; player.atkCd=400;
    enemies.length=0;
    enemies.push(spawnMelee(COLS-2, ROWS-2));
    const s=randEmpty(); enemies.push(spawnRanged(s.x,s.y));
    coins.length=0; for(let i=0;i<6;i++) coins.push(randEmpty());
    potions.length=0; for(let i=0;i<2;i++) potions.push(randEmpty());
    projectiles.length=0;
    // reset quest
    quests.forEach((q,i)=>{
      q.progress=0;
      q.status = (i===0)?'active':'locked';
    });
    currentQuest = 0;
    pathQueue.length=0; draw(); renderQuest();
  }

  function gameOver(){
    alert('Sei stato sconfitto! Respawn senza perdita di livello/EXP.');
    softRespawn();
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
      if(e.type==='ranged') drawActor(e.x,e.y,'#a855f7'); else drawActor(e.x,e.y,getVar('--enemy'));
      drawHpBar(e.x,e.y,e.hp,e.maxHp);
    }
    // player
    drawActor(player.x,player.y,getVar('--player')); drawHpBar(player.x,player.y,player.hp,player.maxHp);
    // projectiles
    for(const pr of projectiles){
      const x=pr.x*TILE+TILE/2, y=pr.y*TILE+TILE/2;
      ctx.fillStyle='#f87171'; ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fill();
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
    ctx.fillStyle:'#7c3aed';   ctx.fillRect(x,y,w*ratio,h);
    ctx.strokeStyle:'#1f2a44'; ctx.strokeRect(x,y,w,h);
    ctx.fillStyle:'#e5e7eb'; ctx.font='12px system-ui'; ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText(`LV ${player.lvl}${player.lvl<MAX_LVL?` — ${Math.floor(ratio*100)}%`:''}`, x, y+h+2);
  }
  function flashHit(tx,ty){
    const x=tx*TILE+TILE/2, y=ty*TILE+TILE/2;
    ctx.save(); ctx.globalAlpha=.25; ctx.fillStyle='#ff0000'; ctx.beginPath(); ctx.arc(x,y,26,0,Math.PI*2); ctx.fill(); ctx.restore();
  }

  // Avvio
  renderQuest(); // prepara UI
  draw();
  setInterval(step,120);
})();
