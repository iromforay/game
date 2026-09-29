// Headless reproduction of round 1's GameScene combat loop.
// Runs the three single-unit and three strict alternating two-unit strategies.

const TILE = 64;
const COLS = 14;
const ROWS = 8;
const DT = 1000 / 60;
const LIMIT_MS = 10 * 60 * 1000;
const RUNS = 100;

const pathGrid = [[-1,1],[9,1],[9,3],[2,3],[2,5],[11,5],[11,7],[COLS,7]];
const path = pathGrid.map(([c,r]) => ({ x:c*TILE+TILE/2, y:r*TILE+TILE/2 }));
const goal = 10;

const units = {
  swarm:{id:'swarm',name:'물량형',hp:34,speed:68,reward:9,cooldown:1000,resistant:'basic',vulnerable:'splash'},
  tank:{id:'tank',name:'탱커형',hp:150,speed:40,reward:20,cooldown:2000,resistant:'splash',vulnerable:'slow'},
  speed:{id:'speed',name:'스피드형',hp:22,speed:130,reward:7,cooldown:1500,resistant:'slow',vulnerable:'basic'},
};
const heroDef={id:'vanguard',name:'뱅가드',hp:260,speed:55,reward:40,resistance:.6,attackRange:90,attackDamage:20,attackRate:800};
const towerDefs = {
  basic:{id:'basic',cost:50,range:150,damage:22,rate:550,projectileSpeed:600},
  splash:{id:'splash',cost:90,range:120,damage:16,rate:1100,projectileSpeed:420,splashRadius:65},
  slow:{id:'slow',cost:70,range:140,damage:6,rate:900,projectileSpeed:480,slowFactor:.45,slowDuration:1500},
  storm:{id:'storm',cost:160,range:105,damage:30,rate:320,projectileSpeed:760,splashRadius:52},
};
const towerHp={basic:140,splash:200,slow:160,storm:260};
const towerOrder=['basic','splash','slow','storm'];

function rng(seed){ return () => ((seed=Math.imul(seed,1664525)+1013904223|0)>>>0)/4294967296; }
function shuffle(a, random){ for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function multiplier(u,type){ return u.isHero?u.def.resistance:type===u.def.resistant?.5:type===u.def.vulnerable?1.5:1; }

function pathTiles(){
  const s=new Set();
  for(let i=0;i<pathGrid.length-1;i++){
    const [c1,r1]=pathGrid[i], [c2,r2]=pathGrid[i+1];
    if(r1===r2) for(let c=Math.min(c1,c2);c<=Math.max(c1,c2);c++) s.add(`${c},${r1}`);
    else for(let r=Math.min(r1,r2);r<=Math.max(r1,r2);r++) s.add(`${c1},${r}`);
  }
  return s;
}

function candidates(random){
  const p=pathTiles(), a=[];
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    if(p.has(`${c},${r}`)||(c===8&&r===2)) continue;
    if(p.has(`${c+1},${r}`)||p.has(`${c-1},${r}`)||p.has(`${c},${r+1}`)||p.has(`${c},${r-1}`)) a.push({col:c,row:r});
  }
  return shuffle(a,random);
}

function spawn(def,isHero=false){ return {def,isHero,hp:def.hp,x:path[0].x,y:path[0].y,seg:0,progress:0,alive:true,reached:false,slowUntil:0,slowFactor:1}; }
function move(u,dt,now){
  if(u.slowUntil>0&&now>u.slowUntil){u.slowFactor=1;u.slowUntil=0;}
  let remaining=u.def.speed*u.slowFactor*dt/1000;
  while(remaining>0&&u.seg<path.length-1){
    const len=dist(path[u.seg],path[u.seg+1]), left=len-u.progress;
    if(remaining<left){u.progress+=remaining;remaining=0;} else {remaining-=left;u.seg++;u.progress=0;if(u.seg>=path.length-1){u.reached=true;break;}}
  }
  const a=path[Math.min(u.seg,path.length-2)], b=path[Math.min(u.seg+1,path.length-1)], len=dist(a,b)||1, t=Math.max(0,Math.min(1,u.progress/len));
  u.x=a.x+(b.x-a.x)*t;u.y=a.y+(b.y-a.y)*t;
}

function simulate(strategy,seed,useHero=false){
  let now=0, gold=0, buildTimer=2600, orderIndex=0, breakthroughs=0, killed=0, sent=0, turn=0;
  let heroLocked=true,heroUsed=false,heroAlive=null,heroLastAttack=0,heroSpawns=0,heroBreakthroughs=0,heroDied=false,towersDestroyed=0;
  const random=rng(seed), tiles=candidates(random), active=[], shots=[], cooldown={swarm:0,tank:0,speed:0};
  const towers=[{...towerDefs.splash,col:8,row:2,x:8*TILE+TILE/2,y:2*TILE+TILE/2,last:0}];
  function tryBuild(){
    if(!tiles.length)return;
    for(let attempt=0;attempt<towerOrder.length;attempt++){
      const type=towerOrder[orderIndex++%towerOrder.length], def=towerDefs[type];
      if(gold<def.cost)continue;
      const tile=tiles.find(q=>!towers.some(t=>t.col===q.col&&t.row===q.row));
      if(!tile)return;
      towers.push({...def,...tile,x:tile.col*TILE+TILE/2,y:tile.row*TILE+TILE/2,last:0});gold-=def.cost;return;
    }
  }
  while(now<=LIMIT_MS&&breakthroughs<goal){
    const type=strategy[turn%strategy.length];
    if(now+1e-7>=cooldown[type]){active.push(spawn(units[type]));cooldown[type]=now+units[type].cooldown;sent++;turn++;}
    buildTimer-=DT;if(buildTimer<=0){buildTimer=2600;tryBuild();}
    if(useHero&&!heroLocked&&!heroUsed){heroAlive=spawn(heroDef,true);heroUsed=true;heroSpawns++;active.push(heroAlive);}
    if(heroAlive&&heroAlive.alive&&now-heroLastAttack>=heroDef.attackRate){
      let target=null,best=Infinity;
      for(const t of towers){const d=dist(heroAlive,t);if(d<=heroDef.attackRange&&d<best){target=t;best=d;}}
      if(target){heroLastAttack=now;target.hp=(target.hp??towerHp[target.id])-heroDef.attackDamage;if(target.hp<=0){const i=towers.indexOf(target);if(i>=0)towers.splice(i,1);towersDestroyed++;}}
    }
    for(const t of towers){
      if(now-t.last<t.rate)continue;
      let target=null,best=Infinity;
      for(const u of active){if(!u.alive)continue;const d=dist(t,u);if(d<=t.range&&d<best){target=u;best=d;}}
      if(target){t.last=now;shots.push({x:t.x,y:t.y,target,def:t,damage:t.damage});}
    }
    for(let i=shots.length-1;i>=0;i--){
      const p=shots[i];if(!p.target.alive){shots.splice(i,1);continue;}
      const d=dist(p,p.target), step=p.def.projectileSpeed*DT/1000;
      if(d<=step){
        const x=p.target.x,y=p.target.y;
        const hit=(u,damage)=>{u.hp-=damage*multiplier(u,p.def.id);if(u.hp<=0)u.alive=false;};
        if(p.def.splashRadius){for(const u of active)if(u.alive&&Math.hypot(u.x-x,u.y-y)<=p.def.splashRadius)hit(u,(u===p.target?p.damage:p.damage*.6));}
        else hit(p.target,p.damage);
        if(p.def.slowFactor&&p.target.alive){if(p.def.slowFactor<p.target.slowFactor)p.target.slowFactor=p.def.slowFactor;p.target.slowUntil=Math.max(p.target.slowUntil,now+p.def.slowDuration);}
        shots.splice(i,1);
      } else {p.x+=(p.target.x-p.x)/d*step;p.y+=(p.target.y-p.y)/d*step;}
    }
    for(const u of active)move(u,DT,now);
    if(heroLocked&&active.some(u=>!u.isHero&&u.seg>=2))heroLocked=false;
    for(let i=active.length-1;i>=0;i--){const u=active[i];if(!u.alive){killed++;gold+=u.def.reward;if(u.isHero){heroAlive=null;heroDied=true;}active.splice(i,1);}else if(u.reached){if(u.isHero){heroAlive=null;heroUsed=false;heroBreakthroughs++;}else breakthroughs++;active.splice(i,1);}}
    now+=DT;
  }
  return {cleared:breakthroughs>=goal,ms:now,breakthroughs,killed,sent,towers:towers.length,heroSpawns,heroBreakthroughs,heroDied,towersDestroyed};
}

const cases=[['물량형 단독',['swarm']],['탱커형 단독',['tank']],['스피드형 단독',['speed']],['물량형 ↔ 탱커형',['swarm','tank']],['물량형 ↔ 스피드형',['swarm','speed']],['탱커형 ↔ 스피드형',['tank','speed']]];
const output=cases.map(([name,strategy])=>{
  const runs=Array.from({length:RUNS},(_,i)=>simulate(strategy,i+1));
  const clears=runs.filter(r=>r.cleared), times=clears.map(r=>r.ms/1000).sort((a,b)=>a-b);
  const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
  return {name,strategy,runs:RUNS,clears:clears.length,clearRate:`${clears.length}%`,averageSeconds:clears.length?+avg(times).toFixed(2):null,medianSeconds:clears.length?+times[Math.floor(times.length/2)].toFixed(2):null,minSeconds:clears.length?+times[0].toFixed(2):null,maxSeconds:clears.length?+times.at(-1).toFixed(2):null,avgBreakthroughs:+avg(runs.map(r=>r.breakthroughs)).toFixed(2),avgSent:+avg(runs.map(r=>r.sent)).toFixed(1),avgKilled:+avg(runs.map(r=>r.killed)).toFixed(1)};
});
console.log(JSON.stringify({dtMs:DT,limitSeconds:LIMIT_MS/1000,runsPerCase:RUNS,output},null,2));

const heroCases=[['탱커형 단독',['tank']],['탱커형 → 물량형',['tank','swarm']],['탱커형 → 스피드형',['tank','speed']]].map(([name,strategy])=>{
  const runs=Array.from({length:RUNS},(_,i)=>simulate(strategy,i+1,true));
  const clears=runs.filter(r=>r.cleared), times=clears.map(r=>r.ms/1000).sort((a,b)=>a-b), avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
  return {name:`${name} + 영웅`,runs:RUNS,clears:clears.length,clearRate:`${clears.length}%`,averageSeconds:clears.length?+avg(times).toFixed(2):null,medianSeconds:clears.length?+times[Math.floor(times.length/2)].toFixed(2):null,minSeconds:clears.length?+times[0].toFixed(2):null,maxSeconds:clears.length?+times.at(-1).toFixed(2):null,heroSurvivalRate:`${runs.filter(r=>!r.heroDied).length}%`,avgHeroSpawns:+avg(runs.map(r=>r.heroSpawns)).toFixed(2),avgTowersDestroyed:+avg(runs.map(r=>r.towersDestroyed)).toFixed(2)};
});
console.log(JSON.stringify({heroPolicy:'해금 즉시 소환, 돌파 후 즉시 재소환, 사망 시 종료',heroOutput:heroCases},null,2));
