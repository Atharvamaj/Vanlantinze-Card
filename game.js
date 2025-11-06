/*
   -------------------------------------------------------------------------
   QUICK CUSTOMIZATION (search “CHANGE ME”):
   - Swap your art and audio file names in ASSETS below.
   - Adjust YES/NO zone rectangles if needed.
   - Balance moves and stats in MOVES / FOE_MOVES and actTurn().
   ========================================================================= */

/* ========================= ASSETS (CHANGE ME) ============================ */
const ASSETS = {
  /* Player walking sprites: two frames per direction */
  PLAYER_SPRITE: {
    up:    ['assets/hero/b1 - Cat.png','assets/hero/b2 - Cat.png'],   // CHANGE ME
    down:  ['assets/hero/f1 - Cat.png','assets/hero/f2 - Cat.png'],   // CHANGE ME
    left:  ['assets/hero/c1l - Cat.png','assets/hero/c2l - Cat.png'], // CHANGE ME
    right: ['assets/hero/c1r - Cat.png','assets/hero/c2r - Cat.png']  // CHANGE ME
  },

  /* Battle sprites (Psyduck back; Tangela front; optional frog used in love scene) */
  MONS: {
    playerBack:  'assets/mons/psyduck_back.png', // CHANGE ME
    yesFoeFront: 'assets/mons/tangela.png',      // CHANGE ME
    extras:      ['assets/mons/f1 - Frog.png']   // optional
  },

  /* Music (set to null if you don’t have files yet) */
  MUSIC: {
    map:    'assets/music_map.mp3',    // CHANGE ME
    battle: 'assets/music_battle.mp3', // CHANGE ME
    happy:  'assets/music_happy.mp3'   // CHANGE ME
  },

  /* UI/props */
  CUTSCENE: {
    heart: 'assets/ui/love.png', // CHANGE ME
    pit:   'assets/bg/pit.png'   // CHANGE ME
  }
};

/* -------- Battle sprite target sizes (tweak for your image scale) */
const BATTLE_SPRITE_TARGET_W = { playerBack: 88, foeFront: 88 };

/* -------- Movement/animation tunables -------- */
const TILE=16, PLAYER_SPEED=3, WALK_SWITCH_MS=180;

/* ===== Canvas & DOM ===== */
const cvs=document.getElementById('game'), ctx=cvs.getContext('2d');
const W=cvs.width, H=cvs.height;

/* ----- Overlays ----- */
const promptOverlay=document.getElementById('promptOverlay');
const promptTitle  =document.getElementById('promptTitle');
const promptText   =document.getElementById('promptText');
const promptYes    =document.getElementById('promptYes');
const promptNo     =document.getElementById('promptNo');

const msgOverlay=document.getElementById('msgOverlay');
const msgTextEl  =document.getElementById('msgText');
const msgOk      =document.getElementById('msgOk');

/* ----- Prompt state ----- */
let promptStage=null, promptSel=0;

/* ----- “Ask-once” gating for YES flow + input cooldown ----- */
let yesPromptSeen = false;
let interactCooldownUntil = 0;

/* ----- Has the player interacted? (controls the beforeunload prompt) ----- */
let hasInteractedOnce = false;

/* ----------------- Input ----------------- */
const Keys=new Set();
let enterLock=false; // debounce Enter

function overlaysActive(){
  return promptOverlay.style.display==='grid' || msgOverlay.style.display==='grid' || state!=='map' || pitActive || blackScreenActive;
}
function inputLocked(){ return pitActive || blackScreenActive; }

addEventListener('keydown',e=>{
  const hot=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Shift'];
  if(hot.includes(e.key)) e.preventDefault();
  if (inputLocked() || promptOverlay.style.display==='grid' || msgOverlay.style.display==='grid') return;

  if(e.key==='Enter'){ if(enterLock) return; enterLock=true; }
  Keys.add(e.key);
});
addEventListener('keyup',e=>{
  if(e.key==='Enter') enterLock=false;
  Keys.delete(e.key);
});

/* ----------------- Loaders ----------------- */
function loadImage(src){return new Promise(res=>{if(!src)return res(null);const i=new Image();i.onload=()=>res(i);i.onerror=()=>res(null);i.src=src;});}
function loadAudio(src,loop=true,vol=.45){if(!src)return null;const a=new Audio(src);a.loop=loop;a.volume=vol;return a;}
const Assets={hero:{up:[],down:[],left:[],right:[]},monPlayer:null,foeDefault:null,extraFoes:[],music:{map:null,battle:null,happy:null},heart:null,pit:null};

async function preload(){
  const jobs=[];
  for(const d of ['up','down','left','right']){
    for(const p of ASSETS.PLAYER_SPRITE[d]) jobs.push(loadImage(p).then(i=>{ if(i) Assets.hero[d].push(i); }));
  }
  jobs.push(loadImage(ASSETS.MONS.playerBack).then(i=>Assets.monPlayer=i));
  jobs.push(loadImage(ASSETS.MONS.yesFoeFront).then(i=>Assets.foeDefault=i));
  for(const p of (ASSETS.MONS.extras||[])) jobs.push(loadImage(p).then(i=>{ if(i) Assets.extraFoes.push(i); }));
  jobs.push(loadImage(ASSETS.CUTSCENE.heart).then(i=>Assets.heart=i));
  jobs.push(loadImage(ASSETS.CUTSCENE.pit).then(i=>Assets.pit=i));
  await Promise.all(jobs);

  // Music (will start after first gesture)
  Assets.music.map    = loadAudio(ASSETS.MUSIC.map,true,.45);
  Assets.music.battle = loadAudio(ASSETS.MUSIC.battle,true,.45);
  Assets.music.happy  = loadAudio(ASSETS.MUSIC.happy,true,.5);
}

/* ----------------- World & Player ----------------- */
const player={x:2,y:2,dir:'down',animTimer:0,frameIndex:0};

function movePlayer(dx,dy,dt){
  if(dx&&dy){dx*=Math.SQRT1_2; dy*=Math.SQRT1_2;}
  const v=PLAYER_SPEED/1000;
  player.x += dx*v*dt; player.y += dy*v*dt;
  if(Math.abs(dx)>Math.abs(dy)) player.dir = dx>0?'right':'left';
  else if(dy!==0) player.dir = dy>0?'down':'up';
  if(dx||dy){ player.animTimer += dt; if(player.animTimer>WALK_SWITCH_MS){ player.frameIndex=(player.frameIndex+1)%2; player.animTimer=0; } }
  else{ player.frameIndex=0; player.animTimer=0; }
}

/* -------- YES/NO zones (invisible) — canvas + floating labels show text -------- */
const YES_ZONE={x:6*TILE,y:5*TILE,w:3*TILE,h:3*TILE,enabled:true};
const NO_ZONE ={x:cvs.width-9*TILE,y:5*TILE,w:3*TILE,h:3*TILE,enabled:true};
function inZone(px,py,z){return z.enabled && px>=z.x && px<=z.x+z.w && py>=z.y && py<=z.y+z.h}

/* -------- NO-side lines -------- */
const NO_LINES=[
  "Oh, this is embarrassing… I hope this doesn’t make things awkward between us.",
  "I know I’m not handsome, but I didn’t know I was so unwanted!",
  "I hope you’re not getting peer-pressured!",
  "Hey, maybe we can just stay friends.",
  "I hope you're not taken already.",
  "I didn’t know you hated programmers that much."
];
let noShown=0, noCount=0; const MAX_NO=6;
//const YES_FIRST_TRY_LINE="Wow, did not expect that! Your chances of saying yes were grim, like 0.09 percent… nice!";

/* -------- Floating YES/NO labels -------- */
const yesLbl=document.createElement('div'); yesLbl.className='hit-label'; yesLbl.textContent='YES'; document.body.appendChild(yesLbl);
const noLbl =document.createElement('div');  noLbl .className='hit-label';  noLbl .textContent='NO';  document.body.appendChild(noLbl);

let pitActive=false, blackScreenActive=false;

/* ----------------- Music ----------------- */
function switchMusic(which){
  [Assets.music.battle,Assets.music.map,Assets.music.happy].forEach(a=>a&&a.pause());
  const pick = which==='battle'?Assets.music.battle : which==='happy'?(Assets.music.happy||Assets.music.map) : Assets.music.map;
  pick && pick.play().catch(()=>{});
}

/* ----------------- Render: Overworld (and Love) -----------------
   Canvas background color for these scenes = #86c06c */
function drawWorld(){
  ctx.fillStyle = '#86c06c';
  ctx.fillRect(0,0,W,H);

  const px=player.x*TILE+TILE/2, py=player.y*TILE+TILE/2;
  const frames=Assets.hero[player.dir]||[]; const img=frames[player.frameIndex]||frames[0];
  if(img) ctx.drawImage(img, Math.round(px-img.width/2), Math.round(py-img.height/2));
  else { ctx.fillStyle='#0d1e0d'; ctx.beginPath(); ctx.arc(px,py,8,0,Math.PI*2); ctx.fill(); ctx.fillStyle='white'; ctx.font='10px system-ui'; ctx.fillText('CAT?', px-12, py-12); }

  // Canvas text labels
  /*if(!overlaysActive()){
    ctx.fillStyle='#0b1d0b'; ctx.font='bold 14px system-ui';
    if(YES_ZONE.enabled) ctx.fillText('YES', YES_ZONE.x, YES_ZONE.y-6);
    if(NO_ZONE.enabled)  ctx.fillText('NO',  NO_ZONE.x,  NO_ZONE.y-6);
  }
*/
  // Floating HTML labels positioned over canvas center of zones
  const r=cvs.getBoundingClientRect();
  function placeLabel(z,el){
    const show=!overlaysActive() && z.enabled;
    const sx=r.left+window.scrollX + (z.x+z.w/2)/W * r.width;
    const sy=r.top +window.scrollY + (z.y+z.h/2)/H * r.height;
    el.style.left=`${sx}px`; el.style.top=`${sy}px`; el.style.display=show?'block':'none';
  }
  placeLabel(YES_ZONE, yesLbl); placeLabel(NO_ZONE, noLbl);
}

/* ----------------- Pit flash before battle ----------------- */
function showPitIntro(next,duration=900){
  pitActive=true;
  const o=document.createElement('canvas'); o.width=W;o.height=H;o.style.position='absolute';
  const r=cvs.getBoundingClientRect();
  o.style.left=r.left+window.scrollX+'px'; o.style.top=r.top+window.scrollY+'px';
  o.style.width=r.width+'px'; o.style.height=r.height+'px'; o.style.pointerEvents='none'; o.style.zIndex=9998;
  document.body.appendChild(o);
  const ox=o.getContext('2d');

  const px=player.x*TILE+TILE/2, py=player.y*TILE+TILE/2;
  const draw=()=>{
    ctx.drawImage(cvs,0,0,W,H,0,0,W,H);
    ox.drawImage(cvs,0,0);
    if(Assets.pit){ const pw=Assets.pit.width, ph=Assets.pit.height; ox.drawImage(Assets.pit, Math.round(px-pw/2), Math.round(py-ph/2)); }
    const base=(Assets.hero.down||[])[0]; if(base) ox.drawImage(base, Math.round(px-base.width/2), Math.round(py-base.height/2));
  };
  const t0=performance.now(); (function step(t){ draw(); if(t-t0<duration) requestAnimationFrame(step); else { o.remove(); pitActive=false; next&&next(); } })(t0);
}

/* ----------------- Black fall (NO) — 5s + walking cycle ----------------- */
function drawWrappedText(ctx2,text,x,y,maxW,lh,maxLines=4){
  const words=(text||'').split(/\s+/); let line='', lines=[], i=0;
  while(i<words.length){
    const test=line?line+' '+words[i]:words[i];
    if(ctx2.measureText(test).width<=maxW){line=test;i++;} else {lines.push(line||words[i]); line=''; if(lines.length>=maxLines)break;}
  }
  if(line && lines.length<maxLines) lines.push(line);
  if(i<words.length){ let last=lines.at(-1)||''; while(ctx2.measureText(last+'…').width>maxW && last.length>0) last=last.slice(0,-1); lines[lines.length-1]=last+'…'; }
  for(let j=0;j<lines.length;j++) ctx2.fillText(lines[j],x,y+j*lh);
}
function playBlackFall(duration=5000,message=''){
  blackScreenActive=true;

  const o=document.createElement('canvas'); o.width=W;o.height=H;o.style.position='absolute';
  const r=cvs.getBoundingClientRect();
  o.style.left=r.left+window.scrollX+'px'; o.style.top=r.top+window.scrollY+'px';
  o.style.width=r.width+'px'; o.style.height=r.height+'px'; o.style.pointerEvents='none'; o.style.zIndex=9999;
  document.body.appendChild(o);
  const ox=o.getContext('2d');

  const downFrames=Assets.hero.down.length?Assets.hero.down:[null,null];
  const sw=downFrames[0]?.width||32, sh=downFrames[0]?.height||32;
  const startY=(H-sh)/2, endY=H+sh, dist=endY-startY, T=Math.max(800,duration);
  const cx=(W-sw)/2; const t0=performance.now();
  const ease=t=>{const x=t/T; return x*x;}; // quadratic ease

  (function step(t){
    const el=t-t0;
    ox.fillStyle='black'; ox.fillRect(0,0,W,H);

    if(message){
      ox.fillStyle='white'; ox.font='14px system-ui'; ox.textAlign='left';
      drawWrappedText(ox,message,12,24,W-24,16,4);
    }

    const frame=Math.floor(el / WALK_SWITCH_MS) % (downFrames.length||1);
    const img=downFrames[frame];
    const y=startY + dist * ease(Math.min(T,el));
    if(img) ox.drawImage(img,Math.round(cx),Math.round(y));
    else { ox.fillStyle='white'; ox.fillRect(Math.round(cx),Math.round(y),16,16); }

    if(el<T) requestAnimationFrame(step);
    else { o.remove(); blackScreenActive=false; }
  })(t0);
}

/* ----------------- Prompts ----------------- */
function showPrompt(){ promptOverlay.style.display='grid'; promptSel=0; applySel(); }
function hidePrompt(){ promptOverlay.style.display='none'; }
function applySel(){ promptYes.classList.toggle('sel',promptSel===0); promptNo.classList.toggle('sel',promptSel===1); }
function openConfirm(){ promptStage='confirm'; promptTitle.textContent='Are you sure?'; promptText.textContent='Are you sure?'; showPrompt(); }
function openPeerNote(){ promptStage='peer'; promptTitle.textContent='Note'; promptText.textContent='I hope you’re not getting peer-pressured.'; showPrompt(); }

promptYes.onclick=()=>{ 
  if(promptStage==='confirm'){
    openPeerNote();
  } else {
    yesPromptSeen = true;      // future YES skips confirm
    hasInteractedOnce = true;  // counts as interaction (disables leave prompt)
    hidePrompt();
    interactCooldownUntil = performance.now() + 500;
    startBattle('yes');
  }
};
promptNo .onclick=()=>{ hasInteractedOnce = true; hidePrompt(); };

/* Overlay-specific keyboard */
addEventListener('keydown',e=>{
  if(promptOverlay.style.display==='grid'){
    if(e.key==='ArrowLeft'){promptSel=0;applySel();}
    if(e.key==='ArrowRight'){promptSel=1;applySel();}
    if(e.key==='Enter'){ (promptSel===0?promptYes.onclick:promptNo.onclick)(); }
    if(e.key==='Shift'){ promptNo.onclick(); }
  }else if(msgOverlay.style.display==='grid'){
    if(e.key==='Enter') { msgOverlay.style.display='none'; }
  }
});

/* ----------------- Message box ----------------- */
function showMessage(text,cb){ msgTextEl.textContent=text; msgOverlay.style.display='grid'; msgOk.onclick=()=>{ msgOverlay.style.display='none'; cb&&cb(); }; }

/* ----------------- Battle Core ----------------- */
const MOVES=[
  {name:'Water Gun', pow:18, acc:0.95, kind:'spec'},
  {name:'Confusion', pow:20, acc:0.90, kind:'spec'},
  {name:'Tail Whip', pow:0,  acc:1.00, kind:'debuff'},
  {name:'Amnesia',   pow:0,  acc:1.00, kind:'buff'}
];
const FOE_MOVES=[
  {name:'Vine Whip', pow:16, acc:0.95, kind:'spec'},
  {name:'Absorb',    pow:14, acc:0.95, kind:'spec'},
  {name:'Stun Spore',pow:0,  acc:0.70, kind:'status'},
  {name:'Harden',    pow:0,  acc:1.00, kind:'buff'}
];
function makeMon(name,hp,atk,def,spd){return {name,maxhp:hp,hp,atk,def,spd,buffs:{def:0},debuffs:{def:0}};}

const Battle={ active:false, mode:'yes', phase:'choose', sel:0, log:[], playerMon:null, foeMon:null, foeImage:null, afterNoMessage:'' };

function startBattle(mode, afterNoMessage=''){
  hasInteractedOnce = true; // entering battle = interaction
  Battle.mode = mode; Battle.active=true; Battle.phase='choose'; Battle.sel=0;
  Battle.log=[ mode==='yes' ? 'A wild Tangela appears!' : 'A wild Tangela challenges you!' ];
  Battle.playerMon=makeMon('Psyduck',72,18,12,12);
  Battle.foeMon   =makeMon('Tangela',62,13,10,9);
  Battle.foeImage = (Assets.extraFoes.length>0 && Math.random()<0.35) ? Assets.extraFoes[Math.floor(Math.random()*Assets.extraFoes.length)] : (Assets.foeDefault||null);
  Battle.afterNoMessage = afterNoMessage;
  switchMusic('battle'); state='battle';
  interactCooldownUntil = performance.now() + 500;
}

function endBattle(){
  Battle.active=false;
  if(Battle.mode==='yes'){
    setTimeout(()=>{
      const isFirstTry = (noCount===0);
      startLoveScene(Battle.foeImage || Assets.foeDefault, isFirstTry);
    },300);
  }else{
    setTimeout(()=>{
      playBlackFall(5000, Battle.afterNoMessage);
      setTimeout(()=>{ switchMusic('map'); state='map'; }, 5200);
    },300);
  }
}

function hpColor(f){return f>0.5?'#1ec28b':f>0.2?'#f4c542':'#e45858';}
function drawHP(mon,x,y,w=120){
  const f=mon.hp/mon.maxhp; ctx.fillStyle='rgba(0,0,0,.25)'; ctx.fillRect(x,y,w,18);
  ctx.fillStyle=hpColor(f); ctx.fillRect(x+4,y+4,(w-8)*f,10);
  ctx.strokeStyle='rgba(0,0,0,.25)'; ctx.strokeRect(x+.5,y+.5,w-1,17);
  ctx.fillStyle='#0b1d0b'; ctx.font='10px system-ui'; ctx.fillText(mon.name,x+6,y+12);
}

/* -------- Battle render (background = #86c06c) -------- */
function drawBattle(){
  // Flat battle background — same green as overworld/love
  ctx.fillStyle='#86c06c';
  ctx.fillRect(0,0,W,H);

  // Player back sprite (scaled)
  if(Assets.monPlayer){
    const tW=BATTLE_SPRITE_TARGET_W.playerBack, s=tW/Assets.monPlayer.width;
    const dw=tW, dh=Math.round(Assets.monPlayer.height*s);
    ctx.drawImage(Assets.monPlayer, 24, 120 + (100 - dh), dw, dh);
  }
  // Foe front sprite (scaled)
  const foe=Battle.foeImage;
  if(foe){
    const tW=BATTLE_SPRITE_TARGET_W.foeFront, s=tW/foe.width;
    const dw=tW, dh=Math.round(foe.height*s);
    ctx.drawImage(foe, W-24-dw, 36 + (100 - dh)/2, dw, dh);
  }

  // HP bars
  drawHP(Battle.playerMon,10,230);
  drawHP(Battle.foeMon, W-10-120, 10);

  // Battle log panel (TOP-LEFT)
  const LOG_W = 220, LOG_H = 46;
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.fillRect(0, 0, LOG_W, LOG_H);
  ctx.fillStyle = '#0b1d0b';
  ctx.font = '12px system-ui';
  const r = Battle.log.slice(-2);
  ctx.fillText(r[0] || '', 10, 18);
  ctx.fillText(r[1] || '', 10, 34);

  // Move selection
  if(Battle.phase==='choose'){
    ctx.fillStyle='rgba(0,0,0,.12)'; ctx.fillRect(W-170,H-60,170,60);
    [0,1,2,3].forEach((i,k)=>{
      const x=W-160+(k%2)*80, y=H-38+Math.floor(k/2)*18, sel=(Battle.sel===k);
      if(sel){ctx.fillStyle='rgba(48,98,48,.35)'; ctx.fillRect(x-8,y-12,78,16);}
      ctx.fillStyle='#0b1d0b'; ctx.font='12px system-ui'; ctx.fillText(MOVES[i].name,x,y);
    });
  }
}

/* -------- Battle turn logic -------- */
function chooseMove(){
  if(inputLocked()) return;
  const dx = Keys.has('ArrowRight')?1 : Keys.has('ArrowLeft')?-1 : 0;
  const dy = Keys.has('ArrowDown')?1 : Keys.has('ArrowUp')?-1 : 0;
  if(dx||dy){
    ['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].forEach(k=>Keys.delete(k));
    let x=Battle.sel%2, y=Math.floor(Battle.sel/2);
    x=Math.max(0,Math.min(1,x+dx)); y=Math.max(0,Math.min(1,y+dy));
    Battle.sel=y*2+x;
  }
  if(Keys.has('Enter')){ Keys.delete('Enter'); actTurn(MOVES[Battle.sel]); }
}

function actTurn(pMove){
  const fMove=FOE_MOVES[Math.floor(Math.random()*FOE_MOVES.length)];
  Battle.phase='anim';

  function apply(user,target,move){
    if(move.kind==='buff'){ user.buffs.def=Math.min(3,user.buffs.def+1); Battle.log.push(`${user.name} braced itself!`); return; }
    if(move.kind==='debuff'){ target.debuffs.def=Math.min(3,target.debuffs.def+1); Battle.log.push(`${target.name}'s guard fell!`); return; }
    if(move.kind==='status'){ if(Math.random()>move.acc){ Battle.log.push(`${user.name}'s ${move.name} missed!`); } else { Battle.log.push(`${user.name} used ${move.name}!`); } return; }
    if(Math.random()>move.acc){ Battle.log.push(`${user.name}'s ${move.name} missed!`); return; }
    const atk=user.atk, defv=target.def + target.buffs.def*3 - target.debuffs.def*2;
    const dmg=Math.max(1,Math.floor(move.pow*(atk/(defv+12))*(0.9+Math.random()*0.25)));
    target.hp=Math.max(0,target.hp-dmg); Battle.log.push(`${user.name} used ${move.name}! (-${dmg})`);
  }

  const order=(Battle.playerMon.spd>=Battle.foeMon.spd)?['player','foe']:['foe','player'];
  for(const who of order){
    if(Battle.playerMon.hp<=0||Battle.foeMon.hp<=0) break;

    if(who==='player'){
      apply(Battle.playerMon,Battle.foeMon,pMove);
      if(Battle.mode==='no'){ if(Battle.foeMon.hp<=0) Battle.foeMon.hp=1; } // NO side can’t win
    }else{
      if(Battle.mode==='yes'){
        const saved=Battle.foeMon.atk; Battle.foeMon.atk=Math.max(1,Math.floor(saved*0.35));
        apply(Battle.foeMon,Battle.playerMon,fMove);
        Battle.foeMon.atk=saved;
        if(Battle.playerMon.hp<=0) Battle.playerMon.hp=1; // YES side can’t lose
      }else{
        const saved=Battle.foeMon.atk; Battle.foeMon.atk=Math.floor(saved*1.25);
        apply(Battle.foeMon,Battle.playerMon,fMove);
      }
    }
  }

  if(Battle.mode==='yes'){
    if(Battle.foeMon.hp<=0 || Battle.foeMon.hp <= Math.ceil(Battle.foeMon.maxhp*0.25)){ Battle.foeMon.hp=0; Battle.log.push('Foe fainted!'); endBattle(); return; }
    Battle.phase='choose';
  }else{
    if(Battle.playerMon.hp<=0 || Battle.playerMon.hp <= Math.ceil(Battle.playerMon.maxhp*0.20)){
      Battle.playerMon.hp=0; Battle.log.push('You fainted…'); endBattle(); return;
    }
    Battle.phase='choose';
  }
}

/* ----------------- Love scene (YES end) ----------------- */
let love={
  active:false,t0:0,catX:-40,catY:H-72,frogX:Math.round(W*0.65),frogY:H-92,
  arriving:true,heartScale:0,showHeart:false,frogImg:null,
  firstTryPending:false, firstTryShown:false
};

function startLoveScene(frogImg, firstTry=false){
  switchMusic('happy'); state='love';
  love.active=true; love.t0=performance.now();
  love.catX=-40; love.catY=H-72; love.frogX=Math.round(W*0.65); love.frogY=H-92;
  love.arriving=true; love.heartScale=0; love.showHeart=false;
  love.frogImg=frogImg || Assets.foeDefault || Assets.extraFoes[0] || null;
  love.firstTryPending = !!firstTry;
  love.firstTryShown = false;
}

function updateLoveScene(now){
  if(!love.active) return;
  const dt=now-love.t0; love.t0=now;
  const speed=60/1000;
  const standX=love.frogX-28;

  if(love.arriving){
    love.catX += speed*dt;
    if(love.catX>=standX){
      love.catX=standX; love.arriving=false;
      setTimeout(()=>{
        love.showHeart=true;
        if(love.firstTryPending && !love.firstTryShown){
          love.firstTryShown = true;
          //setTimeout(()=>{ showMessage(YES_FIRST_TRY_LINE); }, 1200);
        }
      }, 600);
    }
  }

  if(love.showHeart) love.heartScale=Math.min(1, love.heartScale + dt/600);
}

function drawLoveScene(){
  ctx.fillStyle = '#86c06c';
  ctx.fillRect(0,0,W,H);

  const frog=love.frogImg; if(frog) ctx.drawImage(frog, love.frogX, love.frogY);
  const frames=Assets.hero.right||[]; const img=love.arriving ? frames[Math.floor(performance.now()/180)%Math.max(1,frames.length)]||frames[0] : frames[0]||null;
  if(img) ctx.drawImage(img, Math.round(love.catX), Math.round(love.catY));
  if(love.showHeart){
    const heart=Assets.heart; const cx=Math.round((love.catX + (frog ? love.frogX : love.catX+40))/2)+22; const cy=love.frogY-12; const s=Math.max(0.12,love.heartScale);
    ctx.save(); ctx.translate(cx,cy); ctx.scale(s,s);
    if(heart) ctx.drawImage(heart,-heart.width/2,-heart.height/2);
    else { ctx.fillStyle='#ff4d6d'; ctx.beginPath(); ctx.moveTo(0,0);
      ctx.bezierCurveTo(-18,-20,-40,-5,-40,14);
      ctx.bezierCurveTo(-40,34,-20,44,0,58);
      ctx.bezierCurveTo(20,44,40,34,40,14);
      ctx.bezierCurveTo(40,-5,18,-20,0,0);
      ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
}

/* ----------------- Interact (Enter) ----------------- */
function handleInteract(){
  if(inputLocked() || promptOverlay.style.display==='grid' || msgOverlay.style.display==='grid') return;

  const px=player.x*TILE+TILE/2, py=player.y*TILE+TILE/2;

  if(inZone(px,py,YES_ZONE)){
    if (performance.now() < interactCooldownUntil) return;
    showPitIntro(()=>{ 
      if (!yesPromptSeen) {
        openConfirm();         // confirm → peer-note → battle
      } else {
        hasInteractedOnce = true;
        startBattle('yes');    // later: straight to battle
      }
    });
    return;
  }

  if(inZone(px,py,NO_ZONE)){
    const line=NO_LINES[Math.min(noShown,NO_LINES.length-1)];
    if(noShown<NO_LINES.length) noShown++;
    noCount++; if(noCount>=MAX_NO) NO_ZONE.enabled=false;
    showPitIntro(()=>{ hasInteractedOnce = true; startBattle('no', line); });
  }
}

/* ----------------- Gam


e loop ----------------- */
let state='map', last=performance.now();
function update(dt,now){
  if(state==='map'){
    if(!(promptOverlay.style.display==='grid' || msgOverlay.style.display==='grid' || inputLocked())){
      let dx=0,dy=0;
      if(Keys.has('ArrowLeft')) dx=-1; if(Keys.has('ArrowRight')) dx=1; if(Keys.has('ArrowUp')) dy=-1; if(Keys.has('ArrowDown')) dy=1;
      movePlayer(dx,dy,dt);
      if(Keys.has('Enter')){ Keys.delete('Enter'); handleInteract(); }
    }
    drawWorld();
  }else if(state==='battle'){
    drawBattle();
    if(Battle.active && Battle.phase==='choose') chooseMove();
  }else if(state==='love'){
    updateLoveScene(now); drawLoveScene();
  }
}
function loop(now){ const dt=now-last; last=now; ctx.clearRect(0,0,W,H); update(dt,now); requestAnimationFrame(loop); }

/* ----------------- Boot ----------------- */
(function init(){
  preload().then(()=>{
    state='map';
    // First user gesture unlocks audio autoplay
    const kick=()=>{document.removeEventListener('pointerdown',kick);document.removeEventListener('keydown',kick); switchMusic('map');};
    document.addEventListener('pointerdown',kick,{once:true});
    document.addEventListener('keydown',kick,{once:true});
    requestAnimationFrame(loop);
  });
})();

/* ----------------- Leave / close-site prompt -----------------
   Show only if the player has NOT interacted yet:
   (no YES/NO clicks and no battle entered). */
window.addEventListener('beforeunload', (e)=>{
  if(!hasInteractedOnce){
    e.preventDefault();
    e.returnValue =
      "Sorry to put you in this position. I apologize—nothing like this will ever happen again.\n" +
      "Damn, come on, at least play the game.";
    return e.returnValue;
  }
});
