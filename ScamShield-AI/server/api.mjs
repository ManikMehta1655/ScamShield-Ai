import {randomBytes,randomUUID,createHash,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {analyze,modelStats} from './model.mjs';
const derive=promisify(scrypt), COOKIE='scamshield_session', TTL=8*3600;
const now=()=>Math.floor(Date.now()/1000), iso=()=>new Date().toISOString();
const digest=x=>createHash('sha256').update(x).digest('hex');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const check=(v,condition)=>{if(!condition)fail(422,'Invalid input. Check the required fields and their format or length.');return v;};
const string=(v,min,max)=>check(v,typeof v==='string'&&v.length>=min&&v.length<=max);
const username=v=>string(v,3,32).toLowerCase();
const profile=b=>{let name=string(b.display_name,1,80).trim(),email=string(b.email??'',0,254).trim();check(name,!!name&&!/[\x00-\x1f]/.test(name));check(email,!email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));return {display_name:name,email};};
const scanInput=b=>{check(b,!!b&&typeof b==='object');let text=string(b.text,3,10000).trim(),kind=b.kind??'message';check(text,text.length>=3);check(kind,['message','email','url'].includes(kind));check(b.save_history,b.save_history===undefined||typeof b.save_history==='boolean');return {text,kind,save_history:b.save_history===true};};
const hashOptions={N:32768,r:8,p:3,maxmem:96*1024*1024};
async function passwordHash(p){let salt=randomBytes(16);return 'scrypt$'+salt.toString('hex')+'$'+(await derive(p,salt,64,hashOptions)).toString('hex');}
async function verify(p,stored){let parts=String(stored||'').split('$'),valid=parts[0]==='scrypt'&&/^[a-f0-9]{32}$/.test(parts[1]||'')&&/^[a-f0-9]{128}$/.test(parts[2]||'');let salt=valid?Buffer.from(parts[1],'hex'):Buffer.alloc(16),expected=valid?Buffer.from(parts[2],'hex'):Buffer.alloc(64);let actual=await derive(p,salt,64,hashOptions);return timingSafeEqual(expected,actual)&&valid;}
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Strict-Transport-Security':'max-age=31536000','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"};
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{...headers,...extra}});
const cookie=(value,age=TTL)=>`${COOKIE}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`;
const loginResponse=(token,status=200)=>json({authenticated:true},status,{'Set-Cookie':cookie(token)});
const logoutResponse=()=>json({authenticated:false},200,{'Set-Cookie':cookie('',0)});
async function tx(pool,fn){let db=await pool.connect();try{await db.query('BEGIN');let result=await fn(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}}
const one=async(db,sql,args=[])=> (await db.query(sql,args)).rows[0];
async function newSession(db,id){let token=randomBytes(32).toString('base64url');await db.query('DELETE FROM sessions WHERE user_id=$1 AND expires<=$2',[id,now()]);await db.query('INSERT INTO sessions (digest,user_id,expires) VALUES ($1,$2,$3)',[digest(token),id,now()+TTL]);return token;}
async function auth(db,request){let token=request.headers.get('cookie')?.match(/(?:^|;\s*)scamshield_session=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];if(!token)return null;let key=digest(token);let row=await one(db,'SELECT user_id FROM sessions WHERE digest=$1 AND expires>$2',[key,now()]);return row?{id:row.user_id,key}:null;}
async function lockSession(db,session){let u=await one(db,'SELECT id,password_hash FROM users WHERE id=$1 FOR UPDATE',[session.id]);let active=await one(db,'SELECT user_id FROM sessions WHERE digest=$1 AND user_id=$2 AND expires>$3',[session.key,session.id,now()]);if(!u||!active)fail(401,'Sign-in required.');return u;}
async function rate(db,key,limit,seconds){let n=now();let row=await one(db,`INSERT INTO rate_limits (key,expires,count) VALUES ($1,$2,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires<=$3 THEN 1 ELSE rate_limits.count+1 END, expires=CASE WHEN rate_limits.expires<=$3 THEN $2 ELSE rate_limits.expires END RETURNING count`,[digest(key),n+seconds,n]);if(Number(row.count)>limit)fail(429,'Request limit reached. Try again shortly.');}
async function readBody(req){if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail(415,'JSON request required.');let reader=req.body?.getReader();if(!reader)fail(422,'Invalid JSON request.');let bytes=0,chunks=[];try{while(true){let {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>160000){await reader.cancel();fail(413,'Request too large.');}chunks.push(value);}}finally{reader.releaseLock();}try{let b=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!b||Array.isArray(b)||typeof b!=='object')throw Error();return b;}catch{fail(422,'Invalid JSON request.');}}
async function account(db,id){let user=await one(db,'SELECT username,display_name,email,created_at FROM users WHERE id=$1',[id]);if(!user)fail(401,'Sign-in required.');let n=await one(db,'SELECT COUNT(*) AS n FROM sessions WHERE user_id=$1 AND expires>$2',[id,now()]);return {...user,active_sessions:Number(n.n),session_hours:8,secure_cookie:true};}
const history=async(db,id,limit=500)=>(await db.query('SELECT id,created_at,kind,risk_score,risk_level,category FROM scans WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2',[id,limit])).rows;
async function save(pool,session,items,results){if(!items.some(i=>i.save_history))return;await tx(pool,async db=>{await lockSession(db,session);for(let i=0;i<items.length;i++)if(items[i].save_history){let r=results[i];await db.query('INSERT INTO scans (id,user_id,created_at,kind,risk_score,risk_level,category) VALUES ($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),session.id,iso(),items[i].kind,r.risk_score,r.risk_level,r.category]);}await db.query('DELETE FROM scans WHERE user_id=$1 AND id NOT IN (SELECT id FROM scans WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 500)',[session.id]);});}
const csvCell=v=>'"'+String(v).replace(/^[=+\-@\t\r\n]/,"'$&").replaceAll('"','""')+'"';
export function createHandler(pool){return async function handler(req,context={}){try{
  const url=new URL(req.url),path=url.pathname.replace(/^\/\.netlify\/functions\/api(?=\/|$)/,'/api'),method=req.method;
  if(path==='/healthz'&&method==='GET'){await pool.query('SELECT 1');return json({status:'ok'});}
  const route=method+' '+path,open=route==='POST /api/register'||route==='POST /api/login';
  if(['POST','PATCH','DELETE','PUT'].includes(method)){
    let origin=req.headers.get('origin');if(req.headers.get('x-scamshield-request')!=='1'||(origin&&origin!==url.origin)||req.headers.get('sec-fetch-site')==='cross-site')fail(403,'Cross-origin request rejected.');
  }
  const session=await auth(pool,req);if(!open&&!session)fail(401,'Sign-in required.');
  const id=session?.id,peer=context.ip||'unknown';
  if(open){await rate(pool,'public:'+peer,24,300);await rate(pool,'public-global',200,300);}else await rate(pool,'api:'+id,120,60);
  const b=['POST','PATCH','PUT'].includes(method)&&!['POST /api/logout','POST /api/logout-all'].includes(route)?await readBody(req):{};
  if(route==='POST /api/register'){
    let u=username(b.username);check(u,/^[a-z0-9_]{3,32}$/.test(u));let p=string(b.password,12,128),fields=profile(b);await rate(pool,'register:'+peer,8,300);
    let h=await passwordHash(p),userId=randomUUID();try{let token=await tx(pool,async db=>{await db.query('INSERT INTO users (id,username,password_hash,display_name,email,created_at) VALUES ($1,$2,$3,$4,$5,$6)',[userId,u,h,fields.display_name,fields.email,iso()]);if(session)await db.query('DELETE FROM sessions WHERE digest=$1',[session.key]);return newSession(db,userId);});return loginResponse(token,201);}catch(e){if(e.code==='23505'||e.code==='SQLITE_CONSTRAINT_UNIQUE'||String(e.message).includes('UNIQUE constraint failed'))fail(409,'Username unavailable. Choose another.');throw e;}
  }
  if(route==='POST /api/login'){
    let u=username(b.username),p=string(b.password,1,128);await rate(pool,'login:'+u,8,300);let user=await one(pool,'SELECT id,password_hash FROM users WHERE username=$1',[u]);if(!await verify(p,user?.password_hash)||!user)fail(401,'Invalid credentials.');let token=await tx(pool,async db=>{let fresh=await one(db,'SELECT id,password_hash FROM users WHERE id=$1 FOR UPDATE',[user.id]);if(!fresh||fresh.password_hash!==user.password_hash)fail(401,'Invalid credentials.');if(session)await db.query('DELETE FROM sessions WHERE digest=$1',[session.key]);return newSession(db,user.id);});return loginResponse(token);
  }
  if(route==='POST /api/logout'){await pool.query('DELETE FROM sessions WHERE digest=$1 AND user_id=$2',[session.key,id]);return logoutResponse();}
  if(route==='POST /api/logout-all'){await tx(pool,async db=>{await lockSession(db,session);await db.query('DELETE FROM sessions WHERE user_id=$1',[id]);});return logoutResponse();}
  if(route==='GET /api/account')return json(await account(pool,id));
  if(route==='PATCH /api/account'){let p=profile(b);await tx(pool,async db=>{await lockSession(db,session);await db.query('UPDATE users SET display_name=$1,email=$2 WHERE id=$3',[p.display_name,p.email,id]);});return json(await account(pool,id));}
  if(route==='POST /api/account/password'||route==='POST /api/account/delete'){
    await rate(pool,'sensitive:'+id,5,300);let changing=route.endsWith('/password'),p=string(changing?b.current_password:b.password,1,128),next=changing?string(b.new_password,12,128):null;let user=await one(pool,'SELECT password_hash FROM users WHERE id=$1',[id]);if(!await verify(p,user?.password_hash))fail(400,'Current password is incorrect.');let hashed=changing?await passwordHash(next):null;let token=await tx(pool,async db=>{let fresh=await lockSession(db,session);if(fresh.password_hash!==user.password_hash)fail(409,'Account changed. Sign in again.');if(!changing){await db.query('DELETE FROM users WHERE id=$1',[id]);return null;}await db.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hashed,id]);await db.query('DELETE FROM sessions WHERE user_id=$1',[id]);return newSession(db,id);});return changing?loginResponse(token):logoutResponse();
  }
  if(route==='GET /api/model')return json(modelStats);
  if(route==='POST /api/analyze'||route==='POST /api/batch'){let batch=route.endsWith('/batch');if(batch)await rate(pool,'batch:'+id,10,60);let items=batch?b.items:[b];check(items,Array.isArray(items)&&items.length>=1&&items.length<=10);items=items.map(scanInput);let results=items.map(i=>analyze(i.text,i.kind));await save(pool,session,items,results);return json(batch?{results}:results[0]);}
  if(route==='GET /api/history'){let raw=url.searchParams.get('limit')??'500',limit=Number(raw);check(limit,/^\d+$/.test(raw)&&Number.isInteger(limit)&&limit>=1&&limit<=500);return json(await history(pool,id,limit));}
  if(route==='DELETE /api/history'){await tx(pool,async db=>{await lockSession(db,session);await db.query('DELETE FROM scans WHERE user_id=$1',[id]);});return json({cleared:true});}
  if(method==='DELETE'&&path.startsWith('/api/history/')){let scanId=path.slice('/api/history/'.length);check(scanId,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scanId));await tx(pool,async db=>{await lockSession(db,session);if(!(await db.query('DELETE FROM scans WHERE id=$1 AND user_id=$2',[scanId,id])).rowCount)fail(404,'Scan not found.');});return json({deleted:true});}
  if(route==='GET /api/analytics'){let rows=await history(pool,id);return json({total:rows.length,levels:Object.fromEntries(['High','Medium','Low'].map(k=>[k,rows.filter(r=>r.risk_level===k).length])),channels:Object.fromEntries(['message','email','url'].map(k=>[k,rows.filter(r=>r.kind===k).length])),average:rows.length?Math.round(rows.reduce((s,r)=>s+r.risk_score,0)/rows.length*10)/10:0});}
  if(route==='GET /api/history.csv'){let fields=['id','created_at','kind','risk_score','risk_level','category'],rows=await history(pool,id);return new Response([fields.join(','),...rows.map(r=>fields.map(k=>csvCell(r[k])).join(','))].join('\r\n'),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="scamshield-history.csv"'}});}
  fail(404,'Endpoint not found.');
}catch(e){if(e.status)return json({detail:e.message},e.status);console.error('ScamShield request failed:',e.code||e.name);return json({detail:'Service temporarily unavailable. Try again shortly.'},503);}};}
