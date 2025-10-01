/* ===== Barebones RPG (nessun asset) =====
   - Griglia ortogonale 15x9
   - Clic per muovere (path semplice BFS)
   - 1 nemico: pattuglia, poi insegue se vicino
   - Monete raccolte all'impatto
   - HP che scende se tocchi il nemico, reset con pulsante
*/

(() => {
  // Canvas
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const statusEl = document.getElementById('status');
  const btnReset = document.getElementById('btnReset');

  // Mappa
  const COLS = 15, ROWS = 9;
  const TILE = 64; // 15*64 = 960, 9*64=576 → dimensioni canvas
  const map = Array.from({length:ROWS}, ()=>Array(COLS).fill(0)); // 0 walk, 1 block

  // Genera qualche ostacolo semplice
  function genBlocks(){
    for(let i=0;i<22;i++){
      const x = Math.floor(Math.random()*COLS);
      const y = Math.floor(Math.random()*ROWS);
      if((x===1 && y===1) || (x===COLS-2 && y===ROWS-2)) continue;
      map[y][x] = 1;
    }
  }
  genBlocks();

  // Entità
  const player = {x:1, y:1, hp:100, coins:0};
  const enemy  = {x:COLS-2, y:ROWS-2, tick:0, mode:'patrol'};
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

  // Utilità
  const inside = (x,y)=> x>=0 && y>=0 && x<COLS && y<ROWS;
  const walkable = (x,y)=> inside(x,y) && map[y][x]===0;
  const manhattan = (a,b)=> Math.abs(a.x-b.x)+Math.abs(a.y-b.y);

  // Pathfinding BFS semplice
  function bfs(sx,sy, tx,ty){
    if(!walkable(tx,ty)) return null;
    const q = [{x:sx,y:sy}], prev = new Map();
    const key = (x,y)=>`${x},${y}`;
    const seen = new Set([key(sx,sy)]);
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    while(q.length){
      const cur = q.shift();
      if(cur.x===tx && cur.y===ty){
        const path=[]; let k=key(tx,ty);
        while(prev.has(k)){
          const p=prev.get(k);
          const [cx,cy]=k.split(',').map(Number);
          path.push({x:cx,y:cy});
          k=key(p.x,p.y);
        }
        return path.reverse();
      }
      for(const d of dirs){
        const nx=cur.x+d[0], ny=cur.y+d[1], kk=key(nx,ny);
        if(!walkable(nx,ny) || seen.has(kk)) continue;
        seen.add(kk); prev.set(kk,cur); q.push({x:nx,y:ny});
      }
    }
    return null;
  }

  // Input: click → path
  let pathQueue = [];
  function canvasToTile(ev){
    const r = cv.getBoundingClientRect();
    const sx = (ev.clientX - r.left) * (cv.width/r.width);
    const sy = (ev.clientY - r.top ) * (cv.height/r.height);
    const tx = Math.floor(sx / TILE);
    const ty = Math.floor(sy / TILE);
    return {tx,ty};
  }
  cv.addEventListener('click', (ev)=>{
    const {tx,ty} = canvasToTile(ev);
    const p = bfs(player.x, player.y, tx, ty);
    if(p && p.length) pathQueue = p;
  });
  btnReset.addEventListener('click', resetAll);

  // Enemy AI: semplice
  function enemyAI(){
    const dist = manhattan(enemy, player);
    if(dist <= 6) enemy.mode='chase'; else if(dist >= 10) enemy.mode='patrol';

    if(enemy.mode==='chase'){
      // avvicinati con una mossa verso la direzione migliore
      const options = [
        {x:enemy.x+1,y:enemy.y},
        {x:enemy.x-1,y:enemy.y},
        {x:enemy.x,y:enemy.y+1},
        {x:enemy.x,y:enemy.y-1},
      ].filter(p=>walkable(p.x,p.y) && !(p.x===player.x && p.y===player.y)); // non entra nella casella del player
      options.sort((a,b)=> manhattan(a,player)-manhattan(b,player));
      const best = options[0];
      if(best) { enemy.x=best.x; enemy.y=best.y; }
    } else {
      // pattuglia casuale ogni pochi tick
      enemy.tick = (enemy.tick+1)%14;
      if(enemy.tick===0){
        const dirs=[[1,0],[-1,0],[0,1],[0,-1],[0,0]];
        const d = dirs[Math.floor(Math.random()*dirs.length)];
        const nx=enemy.x+d[0], ny=enemy.y+d[1];
        if(walkable(nx,ny) && !(nx===player.x && ny===player.y)){ enemy.x=nx; enemy.y=ny; }
      }
    }
  }

  // Collezione monete e danni
  function handleInteractions(){
    // raccogli monete
    for(let i=coins.length-1;i>=0;i--){
      if(coins[i].x===player.x && coins[i].y===player.y){
        coins.splice(i,1);
        player.coins++;
      }
    }
    // danno se adiacente al nemico
    const touching = manhattan(player, enemy)===0 || manhattan(player, enemy)===1;
    if(touching){
      player.hp = Math.max(0, player.hp-1);
      if(player.hp===0) gameOver();
    }
  }

  // Loop
  function step(){
    // movimento player 1 step per frame
    if(pathQueue.length){
      const next = pathQueue.shift();
      // evita di camminare dentro il nemico se si è messo in mezzo
      if(walkable(next.x,next.y) && !(next.x===enemy.x && next.y===enemy.y)){
        player.x = next.x; player.y = next.y;
      } else {
        pathQueue = []; // blocco percorso
      }
    }
    enemyAI();
    handleInteractions();
    draw();
  }

  // Draw super semplice
  function draw(){
    ctx.clearRect(0,0,cv.width,cv.height);

    // tiles
    for(let y=0;y<ROWS;y++){
      for(let x=0;x<COLS;x++){
        ctx.fillStyle = (map[y][x]===1)? getCssVar('--block') : ((x+y)%2===0? getCssVar('--tileA') : getCssVar('--tileB'));
        ctx.fillRect(x*TILE, y*TILE, TILE, TILE);
      }
    }

    // coins
    ctx.fillStyle = getCssVar('--coin');
    coins.forEach(c=>{
      const cx = c.x*TILE + TILE/2, cy = c.y*TILE + TILE/2;
      ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI*2); ctx.fill();
    });

    // enemy
    drawBox(enemy.x, enemy.y, getCssVar('--enemy'));

    // player
    drawBox(player.x, player.y, getCssVar('--player'));

    // UI testo
    statusEl.textContent = `HP: ${player.hp} | Monete: ${player.coins}`;
  }

  function drawBox(tx,ty,color){
    const x = tx*TILE, y = ty*TILE;
    // ombra
    ctx.fillStyle = getCssVar('--shadow');
    ctx.beginPath(); ctx.ellipse(x+TILE/2, y+TILE-12, 18, 6, 0, 0, Math.PI*2); ctx.fill();
    // corpo
    ctx.fillStyle = color;
    ctx.fillRect(x + TILE/2 - 16, y + TILE/2 - 22, 32, 36);
  }

  function getCssVar(name){
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // Reset / Game Over
  function resetAll(){
    for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) map[y][x]=0;
    genBlocks();
    player.x=1; player.y=1; player.hp=100; player.coins=0;
    enemy.x=COLS-2; enemy.y=ROWS-2; enemy.tick=0; enemy.mode='patrol';
    coins.length=0; for(let i=0;i<6;i++) coins.push(randEmpty());
    pathQueue.length=0;
    draw();
  }
  function gameOver(){
    alert('Sei stato sconfitto! Resetto la partita.');
    resetAll();
  }

  // Start
  draw();
  const TIMER = setInterval(step, 120);
})();
