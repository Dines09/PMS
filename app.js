/* =========================================================
   PMS DASHBOARD — M.V. SEAWAYS MIRAGE
   Mobile-first PWA. Dark-navy default. CSV auto-import.
   PTW-06 permit flash. History-based back navigation.
   ========================================================= */
(function(){
"use strict";

/* ---------- App version ---------- */
const APP_VERSION = '1.4.1';

/* ---------- Storage keys ---------- */
const IMPORTED_JOBS_KEY = 'pms_dashboard_imported_jobs_v3';
const META_KEY = 'pms_dashboard_import_meta_v3';
const LS_KEY = 'pms_dashboard_state_v3';

/* ---------- Load job data ---------- */
let RAW = JSON.parse(document.getElementById('pms-data').textContent);
let IMPORT_META = { vessel:null, company:null, reportDate:null };
(function loadImported(){
  try{
    const stored = JSON.parse(localStorage.getItem(IMPORTED_JOBS_KEY));
    if(Array.isArray(stored) && stored.length) RAW = stored;
  }catch(e){}
  try{
    const m = JSON.parse(localStorage.getItem(META_KEY));
    if(m && typeof m==='object') IMPORT_META = m;
  }catch(e){}
})();

/* ---------- App state ---------- */
function loadState(){
  try{ const s = JSON.parse(localStorage.getItem(LS_KEY)); if(s && typeof s==='object') return s; }catch(e){}
  return { statuses:{}, theme:null, signOffDate:null, jobMeta:{}, jobDueOverride:{}, permits:{} };
}
function saveState(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(STATE)); }catch(e){} }
const STATE = loadState();
STATE.statuses      = STATE.statuses      || {};
STATE.jobMeta       = STATE.jobMeta       || {};
STATE.jobDueOverride= STATE.jobDueOverride|| {};
STATE.permits       = STATE.permits       || {};
STATE.lastDone      = STATE.lastDone      || {};   // id -> most recent done date (for machine view)
STATE.machineHoursAdded = STATE.machineHoursAdded || {}; // machineKey -> cumulative hours the user has added since import (running total of increments)
STATE.hoursJobBase  = STATE.hoursJobBase  || {};   // id -> job's own accumulated hrs snapshot at its last reset (completing a job snaps this so its counter restarts at 0)
STATE.hoursDueDate  = STATE.hoursDueDate  || {};   // id -> ISO date the hours-job first crossed its interval (its due date)
STATE.importantDates= STATE.importantDates|| [];   // [{id, date:ISO, text}] user-added reminders (Home)
STATE.postponedUntil= STATE.postponedUntil|| {};   // occurrence key -> ISO date the user postponed that occurrence to
if(STATE.soundOn   ===undefined) STATE.soundOn   = true;   // tap sound on nav switch (default ON)
if(STATE.vibrateOn ===undefined) STATE.vibrateOn = true;   // haptic vibration on nav switch (default ON)

/* ============================================================
   DATE HELPERS
   ============================================================ */
function todayISO(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
const TODAY = todayISO();
function parseISO(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function fmtISO(dt){ return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0'); }
function addDays(iso,n){ const d=parseISO(iso); d.setDate(d.getDate()+n); return fmtISO(d); }
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function humanDate(iso){ const d=parseISO(iso); return DOW[d.getDay()]+', '+d.getDate()+' '+MON[d.getMonth()]+' '+d.getFullYear(); }
function shortDate(iso){ if(!iso) return '—'; const d=parseISO(iso); return d.getDate()+' '+MON[d.getMonth()].slice(0,3)+' '+d.getFullYear(); }
function shortDateNoYear(iso){ const d=parseISO(iso); return d.getDate()+' '+MON[d.getMonth()].slice(0,3); }
function duePillParts(iso){ const d=parseISO(iso); return { day:d.getDate(), mon:MON[d.getMonth()].slice(0,3) }; }
function daysBetween(a,b){ return Math.round((parseISO(b)-parseISO(a))/86400000); }
function isSaturday(iso){ return parseISO(iso).getDay()===6; }
function nextSaturdayFrom(iso){ let d=iso; for(let i=0;i<7;i++){ if(isSaturday(d)) return d; d=addDays(d,1);} return d; }

function intervalToMonths(intervalStr){
  if(!intervalStr) return null;
  const m = String(intervalStr).trim().match(/^(\d+)\s*([A-Za-z]+)/);
  if(!m) return null;
  const n = Number(m[1]); const unit = m[2].toUpperCase();
  if(unit.startsWith('M')) return n;
  if(unit.startsWith('W')) return n/4.345;
  if(unit.startsWith('Y')) return n*12;
  if(unit.startsWith('D')) return n/30.44;
  return null;
}
function addMonthsISO(iso, months){
  const d = parseISO(iso); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth()+Math.round(months));
  const lastDay = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  d.setDate(Math.min(day,lastDay));
  return fmtISO(d);
}
/* interval parsing */
function parseInterval(intervalStr){
  const m = String(intervalStr||'').trim().toUpperCase().match(/^(\d+)\s*([A-Za-z]+)/);
  if(!m) return { n:null, unit:null };
  return { n:Number(m[1]), unit:m[2][0] }; // unit: M / W / Y / D / H
}
/* Running-hours job = interval measured in hours (e.g. "2000 H"). */
function isHoursJob(job){ return parseInterval(job&&job.interval).unit==='H'; }
function intervalHours(intervalStr){ const {n,unit}=parseInterval(intervalStr); return unit==='H'?n:null; }
function isWeekly(job){
  const {n,unit} = parseInterval(job.interval);
  if(unit==='W') return true;
  if(unit==='D' && n<=7) return true;
  return false;
}
/* Feature: descriptive interval label */
function intervalLabel(intervalStr){
  const {n,unit} = parseInterval(intervalStr);
  if(n==null) return intervalStr||'';
  if(unit==='H'){ return n.toLocaleString()+' Hrs'; }
  if(unit==='W'){ return n===1?'Weekly':n+' Weekly'; }
  if(unit==='D'){ if(n===1) return 'Daily'; if(n===7) return 'Weekly'; return n+' Daily'; }
  if(unit==='Y'){ return n===1?'Yearly':n+' Yearly'; }
  if(unit==='M'){
    if(n===1) return 'Monthly';
    if(n===12) return 'Yearly';
    return n+' Monthly';
  }
  return intervalStr;
}
/* interval in whole months (weeks/days -> fractional) for ranking */
function intervalMonths(intervalStr){
  const {n,unit} = parseInterval(intervalStr);
  if(n==null) return 0;
  if(unit==='Y') return n*12;
  if(unit==='M') return n;
  if(unit==='W') return n/4.345;
  if(unit==='D') return n/30.44;
  return n;
}
/* Colour: 3-monthly = blue; 6-monthly AND anything longer = red; 1-monthly & shorter (weekly/daily) as specified.
   User rule: >6-monthly also red. 3M blue. 1M grey. Weekly frequent -> red. */
function intervalColorClass(intervalStr){
  const {n,unit} = parseInterval(intervalStr);
  if(n==null) return 'interval-grey';
  if(unit==='H') return 'interval-hours';           // running-hours = distinct colour
  const months = intervalMonths(intervalStr);
  if(unit==='M' && n===3) return 'interval-blue';   // 3-monthly = blue
  if(months >= 6) return 'interval-red';            // 6-monthly and longer = red
  if(unit==='W' || (unit==='D' && n<=7)) return 'interval-red'; // weekly frequent = red
  return 'interval-grey';                           // 1-monthly & other shorter = grey
}
/* Universal job sort: critical first, then interval DESCENDING (bigger interval on top). */
function jobSortKey(a,b){
  if((b.critical?1:0)!==(a.critical?1:0)) return (b.critical?1:0)-(a.critical?1:0);
  const ma=intervalMonths(a.interval), mb=intervalMonths(b.interval);
  if(mb!==ma) return mb-ma;                          // bigger interval first
  return getJobDue(a).localeCompare(getJobDue(b));   // tie-break by due date
}
function sortJobs(list){ return list.slice().sort(jobSortKey); }

/* ============================================================
   CSV PARSER
   ============================================================ */
function toTitleCase(s){ return String(s||'').toLowerCase().replace(/\b\w/g, c=>c.toUpperCase()); }
function normDate(raw){
  if(!raw) return '';
  raw = String(raw).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // DD-Mon-YY or DD-Mon-YYYY (PMS exports use 2-digit years, e.g. 11-Jul-26)
  const m = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/);
  if(m){
    const mi=MON.findIndex(x=>x.slice(0,3).toLowerCase()===m[2].toLowerCase());
    if(mi>=0){
      let yr=Number(m[3]); if(m[3].length===2) yr += yr<70 ? 2000 : 1900;   // 26 -> 2026
      return yr+'-'+String(mi+1).padStart(2,'0')+'-'+String(Number(m[1])).padStart(2,'0');
    }
  }
  return raw;
}
function splitCsvLine(line){
  line = line.replace(/^\s*\d+\t/, '');
  const out=[]; let cur=''; let inQ=false;
  for(let i=0;i<line.length;i++){ const ch=line[i];
    if(inQ){ if(ch==='"'){ if(line[i+1]==='"'){cur+='"';i++;} else inQ=false; } else cur+=ch; }
    else { if(ch==='"') inQ=true; else if(ch===','){ out.push(cur); cur=''; } else cur+=ch; } }
  out.push(cur); return out.map(s=>s.trim());
}
function parseCsvToJobs(text){
  const rawLines = text.split(/\r?\n/).filter(l=>l.trim().length);
  const jobs=[]; let autoId=1; let vessel=null,company=null,reportDate=null;
  rawLines.forEach(line=>{
    const f = splitCsvLine(line);
    if(f.length<24) return;
    if((f[5]||'').toLowerCase()!=='sl.') return;
    if(!company){ company=f[0]; vessel=f[2]; reportDate=normDate(f[4]); }
    const groupFull=f[14]||''; if(!groupFull) return;
    const item=f[17]||''; if(!item) return;
    const work=f[18]||''; const hrsRunRaw=f[20]||''; const done=normDate(f[21]||''); const due=normDate(f[22]||'');
    const interval=(f[23]||'').replace(/"/g,'').trim(); const dept=f[24]||''; const critFlag=f[16]||'';
    let system=groupFull,machine=groupFull; const dash=groupFull.indexOf(' - ');
    if(dash>=0){ system=groupFull.slice(0,dash).trim(); machine=groupFull.slice(dash+3).trim(); }
    const hrsRun = hrsRunRaw!=='' && !isNaN(Number(hrsRunRaw)) ? Number(hrsRunRaw) : null;
    jobs.push({ id:autoId++, system:toTitleCase(system), machine:toTitleCase(machine),
      group_full:toTitleCase(system)+' - '+toTitleCase(machine), item:toTitleCase(item),
      work, done, due, interval, dept, hrsRun,
      critical:/^(y|yes|c|crit|critical|\*)$/i.test(String(critFlag).trim()) });
  });
  return { jobs, vessel, company, reportDate };
}
function importAnyFormat(text){
  const trimmed = text.trim();
  if(trimmed.startsWith('[') || trimmed.startsWith('{')){
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.jobs)? parsed.jobs : null);
    if(!arr) throw new Error('bad json');
    return { jobs: arr, vessel:null, company:null, reportDate:null };
  }
  return parseCsvToJobs(text);
}

/* ============================================================
   RUNNING-HOURS ENGINE  (simple additive model)
   Some jobs are due by machine running-hours (interval like "2000 H"), not by
   calendar date. Each such job carries its own accumulated hours at import
   (job.hrsRun, e.g. 366 / 2000). The user, in Running Hours, enters how many
   NEW hours the machine has run since the last update — those hours add to
   every hours-job on that machine. We keep a per-machine running total of all
   the increments the user has entered (STATE.machineHoursAdded[key]).

     job accumulated = job.hrsRun  +  machine's added hours  −  reset offset
     job is DUE when  accumulated >= its interval

   Completing a job snaps its reset offset to the current accumulated value, so
   that job's counter restarts at 0 while the machine keeps climbing.
   ============================================================ */
function machineKey(job){ return job.group_full; }
/* machines that actually carry running-hours jobs (for the updater) */
function hoursMachines(){
  const map = new Map();   // key -> {system, machine, key, jobs:[], maxInterval}
  RAW.forEach(j=>{
    if(!isHoursJob(j)) return;
    const k = machineKey(j);
    if(!map.has(k)) map.set(k, {key:k, system:j.system, machine:j.machine, jobs:[], maxInterval:0});
    const e = map.get(k); e.jobs.push(j);
    e.maxInterval = Math.max(e.maxInterval, intervalHours(j.interval)||0);
  });
  return Array.from(map.values()).sort((a,b)=> a.machine.localeCompare(b.machine));
}
/* total hours the user has added to this machine since import */
function machineAdded(key){ const v = STATE.machineHoursAdded[key]; return v!=null ? v : 0; }
/* a running-hours job's current accumulated hours toward its interval */
function jobAccumHours(job){
  const csvBase = (job.hrsRun!=null ? job.hrsRun : 0);
  const resetOffset = (STATE.hoursJobBase[job.id]!=null ? STATE.hoursJobBase[job.id] : 0);
  return Math.max(0, csvBase + machineAdded(machineKey(job)) - resetOffset);
}
/* same as jobAccumHours but with a hypothetical extra increment not yet saved */
function jobAccumHoursPreview(job, extraHours){
  const csvBase = (job.hrsRun!=null ? job.hrsRun : 0);
  const resetOffset = (STATE.hoursJobBase[job.id]!=null ? STATE.hoursJobBase[job.id] : 0);
  return Math.max(0, csvBase + machineAdded(machineKey(job)) + (extraHours||0) - resetOffset);
}
/* recompute due-dates for hours jobs after a machine's hours change.
   Sets STATE.hoursDueDate[id] = TODAY the first time a job crosses its interval;
   clears it if the job falls back below (e.g. after a reset). */
function recomputeHoursDue(){
  let changed=false;
  RAW.forEach(j=>{
    if(!isHoursJob(j)) return;
    const iv = intervalHours(j.interval); if(!iv) return;
    if(getStatus(j)==='done') return;   // already completed this cycle, waiting to be re-crossed
    const due = jobAccumHours(j) >= iv;
    if(due && !STATE.hoursDueDate[j.id]){ STATE.hoursDueDate[j.id]=TODAY; changed=true; }
    else if(!due && STATE.hoursDueDate[j.id]){ delete STATE.hoursDueDate[j.id]; changed=true; }
  });
  if(changed) saveState();
}
/* add NEW running hours to a machine (increment). Returns the new machine total added. */
function addMachineHours(key, hours){
  hours = Number(hours);
  if(isNaN(hours) || hours<=0) return false;
  STATE.machineHoursAdded[key] = machineAdded(key) + hours;
  saveState();
  recomputeHoursDue();
  return true;
}

/* ============================================================
   JOB STATUS  (per-occurrence: keyed by id@dueDate)
   A status attaches to the specific occurrence (id + its due date at the
   time of marking). When a job is completed its next-due is recalculated;
   that new occurrence has a different key, so it shows as pending again.
   ============================================================ */
function getJobDue(job){
  if(STATE.jobDueOverride[job.id]) return STATE.jobDueOverride[job.id];
  if(isHoursJob(job)) return STATE.hoursDueDate[job.id] || '';   // '' => not yet due (kept out of calendar views)
  return job.due;
}
function statusKey(job){ return job.id + '@' + getJobDue(job); }
function getStatus(job){
  // accept a job object; (legacy id fallback not used)
  return STATE.statuses[statusKey(job)] || null;
}
function setStatusForKey(key, status){ if(status===null) delete STATE.statuses[key]; else STATE.statuses[key]=status; saveState(); }
function setStatus(job, status){ setStatusForKey(statusKey(job), status); }
function isOverdue(job){ const d=getJobDue(job); return d && d < TODAY && getStatus(job)!=='done'; }
function withinSignOff(job){ if(!STATE.signOffDate) return true; return getJobDue(job) <= STATE.signOffDate; }
/* A job with no due date is not scheduled anywhere on the calendar — exclude it
   from the general job pool (still reachable in Machines / search).
   Two cases produce a blank due date:
     - a running-hours job that has not reached its trigger yet, and
     - a calendar job the PMS export ships with an empty "Due" column (a
       never-done long-interval item, e.g. a 120 M renewal).
   Both must be filtered out: '' has no year-month, so letting one through
   creates an empty month bucket that breaks the Monthly view. */
function isScheduled(job){ return !!getJobDue(job); }
function visibleJobs(){ return RAW.filter(j=> isScheduled(j) && withinSignOff(j)); }

/* Occurrences a job appears on:
   - the live occurrence (override||due), pending unless acted on
   - if the cycle advanced (override set) AND the original due was acted on,
     the original due keeps its completed/postponed occurrence too. */
function occurrencesOf(job){
  const live = getJobDue(job);
  if(!live) return [];   // hours-job not yet due => no calendar occurrence
  const arr = [{ date: live, status: STATE.statuses[job.id+'@'+live]||null }];
  const override = STATE.jobDueOverride[job.id];
  if(override && override!==job.due){
    const origStatus = STATE.statuses[job.id+'@'+job.due];
    if(origStatus) arr.push({ date: job.due, status: origStatus });
  }
  return arr;
}
/* all visible occurrences due on a specific date (each carries its own status) */
function occurrencesOnDate(dateISO){
  const out=[];
  visibleJobs().forEach(job=>{
    occurrencesOf(job).forEach(o=>{ if(o.date===dateISO) out.push({job, date:o.date, status:o.status}); });
  });
  return out;
}

/* ============================================================
   PTW-06 PERMITS
   ============================================================ */
function isFocusJob(j){
  const hay = (j.machine+' '+j.item+' '+j.group_full).toLowerCase();
  return hay.includes('motor starter') || hay.includes('breaker routine') ||
         hay.includes('motor overhaul') || hay.includes('starter routine');
}
/* Medical jobs (medicine chest, hospital, medical locker, etc.) — surfaced first in Daily. */
function isMedicalJob(j){
  const hay = (j.system+' '+j.machine+' '+j.item+' '+j.group_full+' '+(j.dept||'')).toLowerCase();
  return hay.includes('medical') || hay.includes('medicine') || hay.includes('hospital');
}
/* Daily-view ordering tier (lower = higher up the list):
   0 Medical · 1 Motor Starters (PTW-06) · 2..N interval DESC (yearly→…→monthly) · last Weekly.
   Weekly is forced to the very bottom; everything else ranks by interval length descending. */
function dailyTier(j){
  if(isMedicalJob(j)) return 0;
  if(isFocusJob(j))   return 1;
  if(isWeekly(j))     return 9999;                 // weekly always last
  // interval-length band: bigger interval → smaller tier number (higher up)
  const months = intervalMonths(j.interval);       // yearly=12, 6M=6, 3M=3, monthly=1…
  return 100 - Math.min(96, months);               // 12→88, 6→94, 3→97, 1→99 (all < weekly's 9999)
}
function dailySortKey(a,b){
  const ta=dailyTier(a), tb=dailyTier(b);
  if(ta!==tb) return ta-tb;
  // within a tier: critical first, then by due date
  if((b.critical?1:0)!==(a.critical?1:0)) return (b.critical?1:0)-(a.critical?1:0);
  return getJobDue(a).localeCompare(getJobDue(b));
}
function createPermitForJob(job, doneISO){
  const pid='P'+job.id;
  // permit becomes due on the routine's done date (per spec)
  STATE.permits[pid]={ id:pid, jobId:job.id, item:job.item, machine:job.machine, system:job.system, doneDate:doneISO, due:doneISO, status:'open', createdAt:TODAY };
  saveState();
}
function activePermits(){ return Object.values(STATE.permits).filter(p=>p.status==='open').sort((a,b)=> a.due.localeCompare(b.due)); }
function permitDone(pid){ if(STATE.permits[pid]){ delete STATE.permits[pid]; saveState(); } }
function permitPostpone(pid){ if(STATE.permits[pid]){ STATE.permits[pid].status='postponed'; saveState(); } }
function reflashPostponedPermits(){ let ch=false; Object.values(STATE.permits).forEach(p=>{ if(p.status==='postponed'){ p.status='open'; ch=true; } }); if(ch) saveState(); }
function updatePermitBell(){
  const bell=document.getElementById('permitBell'); const count=document.getElementById('permitBellCount');
  const n=activePermits().length;
  if(n>0){ count.textContent=n; count.style.display='flex'; bell.classList.add('flash'); }
  else { count.style.display='none'; bell.classList.remove('flash'); }
  document.querySelectorAll('[data-focus-badge]').forEach(el=>{ if(n>0){ el.textContent=n; el.style.display='flex'; } else el.style.display='none'; });
}

/* ============================================================
   TABS + NAV
   ============================================================ */
const TABS = [
  {id:'home',     label:'Home',    icon:'🏠'},
  {id:'daily',    label:'Daily',   icon:'📅'},
  {id:'weekly',   label:'Weekly',  icon:'🔁'},
  {id:'month',    label:'Monthly', icon:'🗓️'},
  {id:'critical', label:'Critical',icon:'⚠️'},
  {id:'done',     label:'Done',    icon:'✅'},
  {id:'postponed',label:'Postponed',icon:'⏸️'},
  {id:'focus',    label:'Motor Starters', icon:'⚙️'},
  {id:'machines', label:'Machines',icon:'🔧'},
  {id:'runninghours', label:'Running Hours', icon:'⏱️'},
  {id:'search',   label:'Search',  icon:'🔍'},
  {id:'settings', label:'Settings',icon:'⚙'},
];
const BOTTOM_TABS = ['home','daily','month','settings'];
/* chip order: critical sits next to machines; running hours shifts further back */
const CHIP_TABS   = ['machines','critical','done','postponed','focus','weekly','runninghours'];

/* ---------- Navigation state (drill-downs) ---------- */
const nav = {
  tab:'home',
  date:TODAY,
  system:null, machine:null,
  focusMonth:null, monthBucket:null,
  critMonth:'all',
  critFilter:'all',        // 'all' | 'done' | 'overdue' — Critical view stat-tile filter
  searchQuery:'',
  impDatesOpen:false,      // Important Dates panel starts collapsed
  homePermitsOpen:false,   // Home PTW-06 panel starts collapsed
  __dayModal:null
};

/* ---------- Survive a page refresh on the current screen ----------
   A reload must NOT dump the user back on Home. We mirror the nav location (and
   the logical history stack behind it, so back still walks out properly) into
   sessionStorage on every navigation and restore it at startup. sessionStorage
   is per-tab and clears when the app is closed, so a genuinely fresh launch
   still opens on Home. */
const NAV_SESSION_KEY = 'pms_nav_session_v1';
function persistNav(){
  try{
    sessionStorage.setItem(NAV_SESSION_KEY, JSON.stringify({
      nav: snapshot(),
      history: HISTORY,
      savedAt: Date.now()
    }));
  }catch(e){}
}
function restoreNav(){
  try{
    const s = JSON.parse(sessionStorage.getItem(NAV_SESSION_KEY));
    if(!s || !s.nav) return false;
    Object.assign(nav, s.nav);
    nav.__dayModal = null;               // don't re-open a transient modal after reload
    HISTORY = Array.isArray(s.history) ? s.history : [];
    // a stale date (app left open past midnight) shouldn't strand the user in the past
    if(nav.tab==='daily' && nav.date < TODAY && s.savedAt && (Date.now()-s.savedAt) > 12*3600*1000) nav.date = TODAY;
    return true;
  }catch(e){ return false; }
}

/* ---------- History stack for hardware back button ---------- */
/* Each entry = a snapshot of nav (deep-ish copy). back() pops to previous. */
let HISTORY = [];

function snapshot(){ return JSON.parse(JSON.stringify(nav)); }
function applySnapshot(s){ Object.assign(nav, s); }

/* Go to a new logical location (records history) */
function go(mutator, opts){
  const prev = snapshot();
  mutator();
  // avoid pushing a duplicate
  if(JSON.stringify(prev)!==JSON.stringify(nav)){
    HISTORY.push(prev);
    if(!(opts && opts.noBrowser)) history.pushState({depth:HISTORY.length}, '');
  }
  render();
}
function switchTab(tabId){
  go(()=>{
    nav.tab = tabId;
    // reset drill-down context when jumping to a top tab
    if(tabId==='machines'){ nav.system=null; nav.machine=null; }
    if(tabId==='month'){ nav.monthBucket=null; }
  });
  window.scrollTo({top:0, behavior:'smooth'});
}

function render(){
  // toggle views
  document.querySelectorAll('.view').forEach(v=> v.classList.remove('active'));
  const view = document.getElementById('view-'+nav.tab);
  if(view) view.classList.add('active');
  // active states on nav
  document.querySelectorAll('.tab-btn').forEach(b=> b.classList.toggle('active', b.dataset.tab===nav.tab));
  document.querySelectorAll('.chip').forEach(b=> b.classList.toggle('active', b.dataset.tab===nav.tab));
  document.querySelectorAll('.nav-item').forEach(b=> b.classList.toggle('active', b.dataset.tab===nav.tab));
  moveNavSlider();
  renderCurrentView();
  if(nav.__dayModal){ showDayModalNow(nav.__dayModal); }
  updatePermitBell();
  persistNav();   // so a refresh lands back on this exact screen
}

function moveNavSlider(){
  const bar = document.getElementById('bottomBar');
  const slider = bar.querySelector('.nav-slider');
  if(!slider) return;
  const active = bar.querySelector('.nav-item.active');
  if(active){
    // The slider and every nav-item share the same offsetParent (the bar), and
    // the slider sits at left:0 (offsetLeft 0). offsetLeft is measured from the
    // bar's padding edge for both, so the active item's offsetLeft is exactly how
    // far to slide — independent of the bar's padding, border, and inter-item gap.
    // getBoundingClientRect().width gives the true rendered (sub-pixel) width.
    slider.style.width = active.getBoundingClientRect().width + 'px';
    slider.style.transform = 'translateX(' + active.offsetLeft + 'px)';
    slider.style.opacity = '1';
  } else {
    slider.style.opacity = '0';
  }
}

function renderNav(){
  const dt = document.getElementById('tabNavDesktop');
  dt.innerHTML = TABS.map(t=>{
    const badge = t.id==='focus' ? '<span class="tb-badge" data-focus-badge style="display:none;">0</span>' : '';
    return '<button class="tab-btn '+(t.id===nav.tab?'active':'')+'" data-tab="'+t.id+'"><span>'+t.icon+'</span><span>'+t.label+'</span>'+badge+'</button>';
  }).join('');
  dt.querySelectorAll('.tab-btn').forEach(b=> b.addEventListener('click', ()=>switchTab(b.dataset.tab)));

  const bb = document.getElementById('bottomBar');
  bb.innerHTML = '<div class="nav-slider"></div>' + BOTTOM_TABS.map(id=>{
    const t=TABS.find(x=>x.id===id);
    return '<button class="nav-item '+(id===nav.tab?'active':'')+'" data-tab="'+id+'"><span class="ni-icon">'+t.icon+'</span><span>'+t.label+'</span></button>';
  }).join('');
  bb.querySelectorAll('.nav-item').forEach(b=> b.addEventListener('click', ()=>{ navFeedback(); switchTab(b.dataset.tab); }));

  const cr = document.getElementById('chipRow');
  cr.innerHTML = CHIP_TABS.map(id=>{
    const t=TABS.find(x=>x.id===id);
    const badge = id==='focus' ? '<span class="chip-badge" data-focus-badge style="display:none;">0</span>' : '';
    return '<button class="chip '+(id===nav.tab?'active':'')+'" data-tab="'+id+'"><span class="c-icon">'+t.icon+'</span><span>'+t.label+'</span>'+badge+'</button>';
  }).join('');
  cr.querySelectorAll('.chip').forEach(b=> b.addEventListener('click', ()=>{ navFeedback(); switchTab(b.dataset.tab); scrollChipIntoView(b.dataset.tab); }));
  updatePermitBell();
  requestAnimationFrame(()=>{ moveNavSlider(); scrollChipIntoView(nav.tab); });
}

/* The chip row is always expanded now; keep the active chip in view as tabs change. */
function scrollChipIntoView(tabId){
  const cr = document.getElementById('chipRow'); if(!cr) return;
  const el = cr.querySelector('.chip[data-tab="'+tabId+'"]'); if(!el) return;
  const target = el.offsetLeft - (cr.clientWidth - el.offsetWidth)/2;
  cr.scrollTo({ left: Math.max(0, target), behavior:'smooth' });
}

function renderCurrentView(){
  switch(nav.tab){
    case 'home': renderHome(); break;
    case 'daily': renderDaily(); break;
    case 'weekly': renderWeekly(); break;
    case 'month': renderMonth(); break;
    case 'critical': renderCritical(); break;
    case 'done': renderStatusList('done'); break;
    case 'postponed': renderStatusList('postponed'); break;
    case 'focus': renderFocus(); break;
    case 'machines': renderMachines(); break;
    case 'runninghours': renderRunningHours(); break;
    case 'search': renderSearch(); break;
    case 'settings': renderSettings(); break;
  }
}

function computeStats(jobs){
  return {
    total: jobs.length,
    critical: jobs.filter(j=>j.critical).length,
    done: statusOccurrences('done').length,
    postponed: statusOccurrences('postponed').length,
    overdue: jobs.filter(isOverdue).length,
    motor: jobs.filter(isFocusJob).length,
  };
}

/* ============================================================
   JOB CARD (with flip)
   ============================================================ */
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function displayWork(job){
  if(isFocusJob(job) && String(job.work).trim().toLowerCase()==='clean') return 'Motor Starter Routine';
  return job.work;
}
function jobCardFront(job, opts){
  opts = opts||{};
  // occurrence-aware: an explicit occDate/occStatus overrides the live one
  const due = opts.occDate || getJobDue(job);
  const status = (opts.occDate!=null) ? (opts.occStatus||null) : getStatus(job);
  const overdue = due < TODAY && status!=='done';
  const cls=['job-card'];
  if(job.critical) cls.push('is-critical');
  if(status==='done') cls.push('is-done');
  if(status==='postponed') cls.push('is-postponed');
  const dp = duePillParts(due);
  const pillCls = status==='done' ? 'done' : (overdue?'overdue':'');
  const icls = intervalColorClass(job.interval);
  // top-right corner status/maintenance tag
  let corner='';
  if(opts.lastMaint) corner = '<div class="corner-tag last">Last Maintenance</div>';
  else if(opts.noStatusCorner) corner = (status==='postponed' ? '<div class="corner-tag postp">Postponed</div>' : '');
  else if(status==='done') corner = '<div class="corner-tag done">Completed</div>';
  else if(status==='postponed') corner = '<div class="corner-tag postp">Postponed</div>';
  // Weekly view: no date pill (they repeat) → show a "WK" chip instead
  const pill = opts.noDate
    ? '<div class="due-pill" style="background:var(--accent-soft);color:var(--accent);"><span class="dp-day" style="font-size:14px;">WK</span></div>'
    : '<div class="due-pill '+pillCls+'"><span class="dp-day">'+dp.day+'</span><span class="dp-mon">'+dp.mon+'</span></div>';
  const occDate = due;   // the date this card represents
  return ''+
    '<div class="'+cls.join(' ')+'" data-job-id="'+job.id+'" data-occ-date="'+occDate+'">'+
      corner+
      pill+
      '<div class="job-info">'+
        '<div class="job-title">'+esc(job.item)+'</div>'+
        '<div class="job-work">Work — <span>'+esc(displayWork(job))+'</span></div>'+
        '<div class="job-sub">'+esc(job.system)+' · '+esc(job.machine)+'</div>'+
        '<div class="job-tags">'+
          '<span class="tag '+icls+'">'+esc(intervalLabel(job.interval))+'</span>'+
          (job.critical?'<span class="tag crit">Critical</span>':'')+
          (isWeekly(job)?'<span class="tag weekly">Weekly</span>':'')+
          (overdue?'<span class="tag overdue">Overdue</span>':'')+
          (isFocusJob(job)?'<span class="tag permit">PTW-06</span>':'')+
        '</div>'+
      '</div>'+
      '<div class="job-actions">'+
        (status
          ? '<button class="act-btn undo" data-action="undo" title="Undo">↺</button>'
          : '<button class="act-btn complete" data-action="done" title="Complete">✓</button><button class="act-btn postpone" data-action="postponed" title="Postpone">⏸</button>')+
      '</div>'+
    '</div>';
}
function jobCardBack(job){
  const lastDone = (STATE.lastDone && STATE.lastDone[job.id]) || job.done;
  return ''+
    '<div class="job-back">'+
      '<div class="jb-label">Last Maintenance</div>'+
      '<div class="jb-date">'+(lastDone?shortDate(lastDone):'No record')+'</div>'+
      (job.dept?'<div class="jb-dept">Dept · '+esc(job.dept)+'</div>':'')+
    '</div>';
}
function jobCard(job, opts){
  opts = opts||{};
  const occDate = opts.occDate || getJobDue(job);
  return ''+
  '<div class="job-flip" data-flip-id="'+job.id+'" data-occ-date="'+occDate+'">'+
    '<div class="job-swipe-wrap" data-job-id="'+job.id+'">'+
      '<div class="swipe-bg right">✓ Complete</div>'+
      '<div class="swipe-bg left">⏸ Postpone</div>'+
      '<div class="flip-inner">'+
        '<div class="flip-face flip-front">'+jobCardFront(job, opts)+'</div>'+
        '<div class="flip-face flip-back">'+jobCardBack(job)+'</div>'+
      '</div>'+
    '</div>'+
  '</div>';
}

function completeJob(id, opts){
  const job = RAW.find(j=>j.id===id);
  if(!job) return;
  const doneDate = (opts && opts.doneDate) || TODAY;
  const location = (opts && opts.location) || 'At Sea';
  // 1) mark the CURRENT occurrence done (uses current due for the key)
  const doneKey = statusKey(job);
  setStatusForKey(doneKey, 'done');
  // meta keyed by the same occurrence key, plus a per-id "last done" for machine view
  STATE.jobMeta[doneKey] = { location, doneDate };
  STATE.lastDone = STATE.lastDone || {};
  STATE.lastDone[id] = doneDate;
  // 2) advance the cycle → next due becomes a fresh (pending) occurrence
  if(isHoursJob(job)){
    // reset this job's accumulated hours to 0: snap its reset offset to the
    // job's current total (csvBase + machine's added hours). It starts counting
    // up again from 0 while the machine keeps climbing. Clear its due date so it
    // drops off the calendar until it crosses its interval again.
    const csvBase = (job.hrsRun!=null ? job.hrsRun : 0);
    STATE.hoursJobBase[id] = csvBase + machineAdded(machineKey(job));
    delete STATE.hoursDueDate[id];
  } else {
    const months = intervalToMonths(job.interval);
    if(months) STATE.jobDueOverride[id] = addMonthsISO(doneDate, months);
  }
  if(isFocusJob(job)) createPermitForJob(job, doneDate);
  saveState();
}
/* Mark an occurrence postponed and push its due date out to `newDue`. */
function postponeJob(id, occDate, newDue){
  const job = RAW.find(j=>j.id===id); if(!job) return;
  const key = job.id+'@'+(occDate||getJobDue(job));
  setStatusForKey(key,'postponed');
  if(newDue){
    STATE.postponedUntil = STATE.postponedUntil || {};
    STATE.postponedUntil[key] = newDue;
    saveState();
  }
  toast(newDue ? 'Postponed to '+shortDate(newDue) : 'Postponed');
  refreshAll();
}
/* Ask WHEN to postpone to (same wheel picker as Complete), then postpone. */
function openPostponePopup(id, occDate){
  const job = RAW.find(j=>j.id===id); if(!job) return;
  const curDue = occDate || getJobDue(job) || TODAY;
  openDatePickerSheet({
    title: 'Postpone — '+job.item,
    initial: addDays(curDue >= TODAY ? curDue : TODAY, 7),   // sensible default: a week out
    okLabel: 'Postpone',
    note: '⏸️ Currently due '+shortDate(curDue)+'.',
    onOk: (iso)=> postponeJob(id, occDate, iso)
  });
}

function attachJobActions(container){
  container.querySelectorAll('.job-flip').forEach(flip=>{
    const id = Number(flip.dataset.flipId);
    const occDate = flip.dataset.occDate;
    // buttons (desktop)
    flip.querySelectorAll('.act-btn').forEach(btn=>{
      btn.addEventListener('click', e=>{
        e.stopPropagation();
        const action = btn.dataset.action;
        if(action==='undo'){ clearJob(id, occDate); return; }
        if(action==='postponed'){ openPostponePopup(id, occDate); return; }
        if(action==='done'){ openCompletePopup(id); }
      });
    });
  });
  attachSwipeAndFlip(container);
}
function clearJob(id, occDate){
  const job = RAW.find(j=>j.id===id); if(!job) return;
  const key = job.id+'@'+(occDate||getJobDue(job));
  const wasDone = STATE.statuses[key]==='done';
  setStatusForKey(key, null);
  delete STATE.jobMeta[key];
  // if we undid a completion, roll the cycle back
  if(wasDone){ delete STATE.jobDueOverride[id]; if(STATE.lastDone) delete STATE.lastDone[id]; const pid='P'+id; if(STATE.permits[pid]) delete STATE.permits[pid];
    if(isHoursJob(job)){ delete STATE.hoursJobBase[id]; recomputeHoursDue(); } }
  saveState(); toast('Status cleared'); refreshAll();
}
function refreshAll(){ updatePermitBell(); renderCurrentView(); }

/* ---- flip management: only one card flipped at a time, auto re-flip ---- */
let currentFlipped = null;
let flipTimer = null;
function unflipCurrent(){
  if(currentFlipped){ currentFlipped.classList.remove('flipped'); currentFlipped=null; }
  if(flipTimer){ clearTimeout(flipTimer); flipTimer=null; }
}
function flipCard(flip){
  if(currentFlipped && currentFlipped!==flip){ currentFlipped.classList.remove('flipped'); }
  if(flipTimer){ clearTimeout(flipTimer); flipTimer=null; }
  flip.classList.add('flipped');
  currentFlipped = flip;
  flipTimer = setTimeout(()=>{ if(currentFlipped===flip){ flip.classList.remove('flipped'); currentFlipped=null; } }, 5000);
}

/* Swipe (mobile) + single-tap flip */
function attachSwipeAndFlip(container){
  container.querySelectorAll('.job-flip').forEach(flip=>{
    const wrap = flip.querySelector('.job-swipe-wrap');
    const inner = flip.querySelector('.flip-inner');
    const card = flip.querySelector('.flip-front .job-card');
    const id = Number(wrap.dataset.jobId);
    const occDate = flip.dataset.occDate;
    const bgRight = wrap.querySelector('.swipe-bg.right');
    const bgLeft  = wrap.querySelector('.swipe-bg.left');
    let startX=0,startY=0,dx=0,dragging=false,decided=false,isH=false,moved=false;
    const T=80;

    function resetPos(){ inner.style.transition='transform .2s ease'; inner.style.transform=''; bgRight.style.opacity=0; bgLeft.style.opacity=0; }

    card.addEventListener('touchstart', e=>{
      if(e.target.closest('.act-btn')) return;
      if(flip.classList.contains('flipped')) return;
      const t=e.touches[0]; startX=t.clientX; startY=t.clientY; dx=0;
      dragging=true; decided=false; isH=false; moved=false; inner.style.transition='none';
    }, {passive:true});
    card.addEventListener('touchmove', e=>{
      if(!dragging) return;
      const t=e.touches[0]; const diffX=t.clientX-startX, diffY=t.clientY-startY;
      if(!decided){ if(Math.abs(diffX)>8||Math.abs(diffY)>8){ decided=true; isH=Math.abs(diffX)>Math.abs(diffY); moved=true; } }
      if(!isH) return;
      e.preventDefault(); dx=diffX; inner.style.transform='translateX('+dx+'px)';
      if(dx>0){ bgRight.style.opacity=Math.min(1,dx/T); bgLeft.style.opacity=0; }
      else { bgLeft.style.opacity=Math.min(1,-dx/T); bgRight.style.opacity=0; }
    }, {passive:false});
    card.addEventListener('touchend', ()=>{
      if(!dragging) return; dragging=false;
      if(isH && Math.abs(dx)>=T){
        if(dx>0){
          // swipe right → open the complete popup (location + scroll date)
          resetPos();
          openCompletePopup(id);
        } else {
          // swipe left → ask which date to postpone to (same wheel picker as Complete)
          resetPos();
          openPostponePopup(id, occDate);
        }
        return;
      }
      resetPos();
    });
    card.addEventListener('touchcancel', resetPos);

    // single tap (front) => flip; tap (back) => flip back
    card.addEventListener('click', e=>{
      if(e.target.closest('.act-btn')) return;
      if(moved) { moved=false; return; }
      if(flip.classList.contains('flipped')) unflipCurrent();
      else flipCard(flip);
    });
    flip.querySelector('.flip-back').addEventListener('click', unflipCurrent);
  });
}

/* ============================================================
   GENERIC HORIZONTAL SWIPE
   Attaches left/right swipe navigation to any element (empty areas of the
   month calendar, the day header, …). Vertical drags are left alone so the
   page still scrolls normally. onLeft = swiped leftwards (→ next),
   onRight = swiped rightwards (→ previous).
   ============================================================ */
function attachHSwipe(el, onLeft, onRight, opts){
  if(!el) return;
  const T = (opts && opts.threshold) || 60;
  let startX=0, startY=0, dx=0, decided=false, isH=false, active=false;
  el.addEventListener('touchstart', e=>{
    if(e.touches.length!==1) { active=false; return; }
    // ignore drags that start on an interactive child (buttons, cells with jobs…)
    if(opts && opts.ignoreSelector && e.target.closest(opts.ignoreSelector)) { active=false; return; }
    const t=e.touches[0]; startX=t.clientX; startY=t.clientY; dx=0;
    active=true; decided=false; isH=false;
  }, {passive:true});
  el.addEventListener('touchmove', e=>{
    if(!active) return;
    const t=e.touches[0]; const diffX=t.clientX-startX, diffY=t.clientY-startY;
    if(!decided){
      if(Math.abs(diffX)>10 || Math.abs(diffY)>10){ decided=true; isH = Math.abs(diffX) > Math.abs(diffY)*1.3; }
    }
    if(!isH) return;
    e.preventDefault();
    dx=diffX;
    el.style.transition='none';
    el.style.transform='translateX('+(dx*0.28)+'px)';   // subtle rubber-band feedback
    el.style.opacity = String(1 - Math.min(0.35, Math.abs(dx)/700));
  }, {passive:false});
  const settle = ()=>{ el.style.transition='transform .18s ease, opacity .18s ease'; el.style.transform=''; el.style.opacity=''; };
  el.addEventListener('touchend', ()=>{
    if(!active) return; active=false;
    const d=dx; settle();
    if(isH && Math.abs(d)>=T){ if(d<0){ if(onLeft) onLeft(); } else { if(onRight) onRight(); } }
  });
  el.addEventListener('touchcancel', ()=>{ active=false; settle(); });
}

/* ============================================================
   COMPLETE POPUP — bottom sheet with location + scrollable date wheels
   ============================================================ */
function closePopover(){ document.getElementById('popoverRoot').innerHTML=''; }

/* Build a scrollable wheel column. items = [{v,label}]. Returns selected value via data attr. */
function wheelColumn(name, items, selectedVal){
  const opts = items.map(it=> '<div class="wheel-item" data-val="'+it.v+'">'+it.label+'</div>').join('');
  return '<div class="wheel" data-wheel="'+name+'" data-val="'+selectedVal+'"><div class="wheel-track">'+opts+'</div></div>';
}

/* Markup for a day/month/year wheel trio, pre-selected to `iso`. */
function dateWheelsHtml(iso){
  const base = parseISO(iso || TODAY);
  const curY = base.getFullYear();
  const years=[]; for(let y=curY-3; y<=curY+5; y++) years.push({v:y,label:String(y)});
  const months = MON.map((m,i)=>({v:i+1,label:m.slice(0,3)}));
  const days=[]; for(let d=1; d<=31; d++) days.push({v:d,label:String(d)});
  return '<div class="wheel-row">'+
      wheelColumn('day', days, base.getDate())+
      wheelColumn('mon', months, base.getMonth()+1)+
      wheelColumn('year', years, curY)+
      '<div class="wheel-highlight"></div>'+
    '</div>';
}
/* Read the current wheel selection out of `scope` as an ISO date string. */
function readDateWheels(scope){
  const d = +scope.querySelector('[data-wheel="day"]').dataset.val;
  const m = +scope.querySelector('[data-wheel="mon"]').dataset.val;
  const y = +scope.querySelector('[data-wheel="year"]').dataset.val;
  const lastDay = new Date(y, m, 0).getDate();       // clamp 31 Feb → 28/29 Feb
  return y+'-'+String(m).padStart(2,'0')+'-'+String(Math.min(d,lastDay)).padStart(2,'0');
}

/* Generic "pick a date" bottom sheet built on the same wheels as Complete.
   opts = {title, initial, okLabel, note, onOk(iso)} */
function openDatePickerSheet(opts){
  closePopover();
  const root = document.getElementById('popoverRoot');
  root.innerHTML =
    '<div class="sheet-overlay" id="dpOverlay"></div>'+
    '<div class="complete-sheet" id="dpSheet">'+
      '<div class="cs-grip"></div>'+
      '<div class="cs-title">'+esc(opts.title||'Pick a date')+'</div>'+
      '<div class="cs-sub">Date <span style="color:var(--text-faint);font-weight:600;">(scroll ↕)</span></div>'+
      dateWheelsHtml(opts.initial||TODAY)+
      (opts.note? '<div class="cs-permit">'+opts.note+'</div>' : '')+
      '<div class="cs-actions"><button class="btn" id="dpCancel">Cancel</button>'+
        '<button class="btn primary" id="dpOk">'+esc(opts.okLabel||'OK')+'</button></div>'+
    '</div>';
  document.getElementById('dpOverlay').addEventListener('click', closePopover);
  document.getElementById('dpCancel').addEventListener('click', closePopover);
  root.querySelectorAll('.wheel').forEach(setupWheel);
  document.getElementById('dpOk').addEventListener('click', ()=>{
    const iso = readDateWheels(root);
    closePopover();
    if(opts.onOk) opts.onOk(iso);
  });
}

/* Generic confirm bottom sheet — used for destructive actions (delete, reset). */
function openConfirmSheet(opts){
  const root = document.getElementById('popoverRoot');
  root.innerHTML =
    '<div class="sheet-overlay" id="cfOverlay"></div>'+
    '<div class="exit-sheet">'+
      '<div class="exit-title">'+esc(opts.title||'Are you sure?')+'</div>'+
      (opts.body? '<div style="font-size:12.5px;color:var(--text-dim);text-align:center;margin:-6px 0 14px;">'+esc(opts.body)+'</div>' : '')+
      '<div class="exit-actions"><button class="btn" id="cfCancel">'+esc(opts.cancelLabel||'Cancel')+'</button>'+
        '<button class="btn '+(opts.danger===false?'primary':'danger')+'" id="cfOk">'+esc(opts.okLabel||'Delete')+'</button></div>'+
    '</div>';
  const close=()=>{ root.innerHTML=''; if(opts.onCancel) opts.onCancel(); };
  document.getElementById('cfOverlay').addEventListener('click', close);
  document.getElementById('cfCancel').addEventListener('click', close);
  document.getElementById('cfOk').addEventListener('click', ()=>{ root.innerHTML=''; if(opts.onOk) opts.onOk(); });
}
function openCompletePopup(jobId){
  closePopover();
  const job = RAW.find(j=>j.id===jobId); if(!job) return;
  const focus = isFocusJob(job);
  const root = document.getElementById('popoverRoot');

  root.innerHTML =
    '<div class="sheet-overlay" id="cpOverlay"></div>'+
    '<div class="complete-sheet" id="cpSheet">'+
      '<div class="cs-grip"></div>'+
      '<div class="cs-title">Complete — '+esc(job.item)+'</div>'+
      '<div class="cs-sub">Where was it done?</div>'+
      '<div class="cs-loc" id="cpLoc">'+
        '<button class="cs-loc-btn active" data-loc="At Sea">At Sea</button>'+
        '<button class="cs-loc-btn" data-loc="At Port">At Port</button>'+
        '<button class="cs-loc-btn" data-loc="At Anchor">At Anchor</button>'+
      '</div>'+
      '<div class="cs-sub">Done date <span style="color:var(--text-faint);font-weight:600;">(scroll ↕)</span></div>'+
      dateWheelsHtml(TODAY)+
      (focus?'<div class="cs-permit">📋 A PTW-06 permit will be raised (due on this done date).</div>':'')+
      '<div class="cs-actions"><button class="btn" id="cpCancel">Cancel</button><button class="btn primary" id="cpOk">OK</button></div>'+
    '</div>';

  document.getElementById('cpOverlay').addEventListener('click', closePopover);
  document.getElementById('cpCancel').addEventListener('click', closePopover);
  // location buttons
  root.querySelectorAll('.cs-loc-btn').forEach(b=> b.addEventListener('click', ()=>{
    root.querySelectorAll('.cs-loc-btn').forEach(x=>x.classList.remove('active')); b.classList.add('active');
  }));
  // wheels
  root.querySelectorAll('.wheel').forEach(setupWheel);

  document.getElementById('cpOk').addEventListener('click', ()=>{
    const loc = root.querySelector('.cs-loc-btn.active').dataset.loc;
    const doneDate = readDateWheels(root);
    completeJob(jobId, {location:loc, doneDate});
    closePopover(); toast('Marked complete'); refreshAll();
    // offer to apply the same done date to due sibling jobs on this machine
    maybeOfferBatchSameDay(jobId, doneDate, loc);
  });
}

/* ============================================================
   BATCH SAME-DAY UPDATE
   After completing one job, sibling jobs in the SAME SYSTEM (same j.system)
   that are ALSO due (due on-or-before the done date) and still pending get
   offered the same done date. All ticked by default; user can untick any.
   Grouping by system (not the machine sub-group) so a whole system's due jobs
   can be knocked out together.
   ============================================================ */
function batchSiblings(sourceId, doneDate){
  const src = RAW.find(j=>j.id===sourceId); if(!src) return [];
  return RAW.filter(j=>{
    if(j.id===sourceId) return false;
    if(j.system!==src.system) return false;            // same SYSTEM (all machines under it)
    if(!isScheduled(j)) return false;                  // hours-jobs not yet due are skipped
    if(getStatus(j)==='done') return false;            // already done this cycle
    const due = getJobDue(j);
    if(!due) return false;
    return due <= doneDate;                             // also due on-or-before the completion date
  });
}
function maybeOfferBatchSameDay(sourceId, doneDate, location){
  const sibs = batchSiblings(sourceId, doneDate);
  if(!sibs.length) return;
  const src = RAW.find(j=>j.id===sourceId);
  const root = document.getElementById('popoverRoot');
  const rows = sortJobs(sibs).map(j=>{
    const due=getJobDue(j);
    return '<div class="batch-item checked" data-bid="'+j.id+'">'+
        '<div class="batch-check">✓</div>'+
        '<div class="batch-info">'+
          '<div class="bi-title">'+esc(j.item)+(j.critical?' <span class="tag crit" style="vertical-align:middle;">Critical</span>':'')+'</div>'+
          '<div class="bi-sub">Work — '+esc(displayWork(j))+'</div>'+
          '<div class="bi-due">Due '+shortDate(due)+(due<TODAY?' · overdue':'')+'</div>'+
        '</div>'+
      '</div>';
  }).join('');
  root.innerHTML =
    '<div class="sheet-overlay" id="batchOverlay"></div>'+
    '<div class="complete-sheet" id="batchSheet">'+
      '<div class="cs-grip"></div>'+
      '<div class="cs-title">Also done on '+shortDate(doneDate)+'?</div>'+
      '<div class="batch-note">Other due jobs in <b>'+esc(src.system)+'</b>. Untick any you didn\'t do. Ticked jobs will be marked complete on <b>'+shortDate(doneDate)+'</b>.</div>'+
      '<div class="batch-list" id="batchList">'+rows+'</div>'+
      '<div class="cs-actions"><button class="btn" id="batchSkip">Skip</button><button class="btn primary" id="batchApply">Apply to selected</button></div>'+
    '</div>';
  const close=()=>{ root.innerHTML=''; };
  document.getElementById('batchOverlay').addEventListener('click', close);
  document.getElementById('batchSkip').addEventListener('click', close);
  root.querySelectorAll('.batch-item').forEach(it=> it.addEventListener('click', ()=>{ if(it.classList.contains('applied')) return; it.classList.toggle('checked'); }));
  document.getElementById('batchApply').addEventListener('click', ()=>{
    const checked = Array.from(root.querySelectorAll('.batch-item.checked'));
    const ids = checked.map(el=>Number(el.dataset.bid));
    if(!ids.length){ close(); return; }
    ids.forEach(id=> completeJob(id, {location, doneDate}));
    // Confirm visually: turn every applied row solid-green + "Done", lock it,
    // so the user sees the whole batch go green before the sheet closes.
    checked.forEach(el=>{
      el.classList.add('applied');
      const due = el.querySelector('.bi-due');
      if(due){ due.textContent = 'Done '+shortDate(doneDate); due.classList.add('done'); }
    });
    const apply = document.getElementById('batchApply');
    if(apply){ apply.textContent = '✓ Done'; apply.disabled = true; }
    toast(ids.length+' more marked complete');
    setTimeout(()=>{ close(); refreshAll(); }, 750);
  });
}
/* wheel: snap-scroll; the centered item is the selected value */
const WHEEL_ITEM_H = 38;
function setupWheel(wheel){
  const track = wheel.querySelector('.wheel-track');
  const items = Array.from(wheel.querySelectorAll('.wheel-item'));
  const selVal = wheel.dataset.val;
  const idx = Math.max(0, items.findIndex(it=> it.dataset.val===String(selVal)));
  function setIndex(i, smooth){
    i = Math.max(0, Math.min(items.length-1, i));
    track.style.transition = smooth?'transform .18s ease':'none';
    track.style.transform = 'translateY('+(-i*WHEEL_ITEM_H)+'px)';
    wheel.dataset.val = items[i].dataset.val;
    items.forEach((it,j)=> it.classList.toggle('sel', j===i));
  }
  setIndex(idx, false);
  let curIdx = idx;
  // wheel scroll (desktop)
  wheel.addEventListener('wheel', e=>{ e.preventDefault(); curIdx += (e.deltaY>0?1:-1); curIdx=Math.max(0,Math.min(items.length-1,curIdx)); setIndex(curIdx,true); }, {passive:false});
  // touch drag (mobile)
  let startY=0, startIdx=0, dragging=false;
  wheel.addEventListener('touchstart', e=>{ dragging=true; startY=e.touches[0].clientY; startIdx=curIdx; track.style.transition='none'; }, {passive:true});
  wheel.addEventListener('touchmove', e=>{ if(!dragging) return; const dy=e.touches[0].clientY-startY; const off=startIdx*WHEEL_ITEM_H - dy; track.style.transform='translateY('+(-off)+'px)'; }, {passive:true});
  wheel.addEventListener('touchend', e=>{ if(!dragging) return; dragging=false; const dy=(e.changedTouches[0].clientY-startY); curIdx = startIdx - Math.round(dy/WHEEL_ITEM_H); setIndex(curIdx,true); });
  // click an item to select
  items.forEach((it,j)=> it.addEventListener('click', ()=>{ curIdx=j; setIndex(j,true); }));
}

/* ============================================================
   PERMIT MODAL
   ============================================================ */
function openPermitModal(){
  const permits = activePermits();
  const root = document.getElementById('modalRoot');
  root.innerHTML =
    '<div class="modal-overlay" id="permitOverlay"><div class="modal-sheet" onclick="event.stopPropagation()">'+
      '<div class="modal-head"><h3>📋 PTW-06 Permits '+(permits.length?'— '+permits.length:'')+'</h3><button class="icon-btn" id="permitClose">✕</button></div>'+
      (permits.length?
        '<div style="font-size:11.5px;color:var(--text-faint);margin-bottom:10px;">Oldest first · tap a permit to sign it off</div>'+
        permits.map(permitRow).join('')+
        '<button class="btn primary" id="permitExport" style="margin-top:10px;">⬇ Export to Excel (.xls)</button>'
        :
        '<div class="empty-state"><div class="big-icon">✓</div><div class="msg">No open permits</div><div class="sub">Complete a Motor Starter / Routine job to raise a PTW-06 permit here.</div></div>')+
    '</div></div>';
  document.getElementById('permitOverlay').addEventListener('click', ()=>{ root.innerHTML=''; });
  document.getElementById('permitClose').addEventListener('click', ()=>{ root.innerHTML=''; });
  const ex=document.getElementById('permitExport'); if(ex) ex.addEventListener('click', (e)=>{ e.stopPropagation(); exportPermitsXls(); });
  attachPermitActions(root);
}
/* Read-only permit row: only Item, Done date, Due date. Tap row to sign it off. */
function permitRow(p){
  const overdue = p.due < TODAY;
  const doneStr = p.doneDate ? shortDate(p.doneDate) : '—';
  return ''+
    '<div class="permit-item '+(overdue?'overdue':'')+'" data-pid="'+p.id+'" title="Tap to sign off">'+
      '<div class="permit-info">'+
        '<div class="pi-title">'+esc(p.item)+'</div>'+
        '<div class="pi-dates"><span class="pi-dl">Done</span> '+doneStr+' &nbsp;·&nbsp; <span class="pi-dl">Due</span> '+shortDate(p.due)+(overdue?' · OVERDUE':'')+'</div>'+
      '</div>'+
      '<div class="pi-tap">✓</div>'+
    '</div>';
}
function attachPermitActions(scope){
  scope.querySelectorAll('.permit-item').forEach(row=>{
    const pid=row.dataset.pid;
    row.addEventListener('click', ()=>{
      permitDone(pid); toast('Permit signed off');
      updatePermitBell();
      if(document.getElementById('permitOverlay')) openPermitModal();
      if(nav.tab==='focus') renderFocus();
      if(nav.tab==='home') renderHome();
    });
  });
}
/* Export the permit list to an .xls (HTML-table based; opens in Excel/WPS). */
function exportPermitsXls(){
  const permits = activePermits();
  if(!permits.length){ toast('No permits to export'); return; }
  let rows = permits.map(p=>'<tr><td>'+esc(p.item)+'</td><td>'+(p.doneDate?shortDate(p.doneDate):'')+'</td><td>'+shortDate(p.due)+'</td></tr>').join('');
  const html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body>'+
    '<table border="1"><thead><tr><th>PMS Item</th><th>Done Date</th><th>Due Date</th></tr></thead><tbody>'+rows+'</tbody></table></body></html>';
  downloadBlob(new Blob([html],{type:'application/vnd.ms-excel'}), 'PTW06_permits_'+TODAY+'.xls');
  toast('Permits exported to Excel');
}

/* ============================================================
   VIEW: HOME
   ============================================================ */
function renderHome(){
  const jobsAll = visibleJobs();
  const s = computeStats(jobsAll);
  const pending = s.total - s.done;
  const overallPct = s.total? Math.round(s.done/s.total*100):0;
  const todayOccs = occurrencesOnDate(TODAY);
  const todayDone = todayOccs.filter(o=>o.status==='done').length;
  const todayPct = todayOccs.length? Math.round(todayDone/todayOccs.length*100):0;
  const curMonth = TODAY.slice(0,7);
  const monthJobs = jobsAll.filter(j=>getJobDue(j).slice(0,7)===curMonth);
  const monthDone = statusOccurrences('done').filter(o=>o.doneDate.slice(0,7)===curMonth).length;
  const monthTotal = monthJobs.length + monthDone;
  const monthPct = monthTotal? Math.round(monthDone/monthTotal*100):0;
  const next7=[];
  for(let i=0;i<7;i++){ const d=addDays(TODAY,i); const occ=occurrencesOnDate(d); next7.push({d, cnt:occ.length, crit:occ.filter(o=>o.job.critical).length}); }
  const upcomingCrit = jobsAll.filter(j=> j.critical && getStatus(j)!=='done' && getJobDue(j)>=TODAY && getJobDue(j).slice(0,7)===curMonth).sort((a,b)=>getJobDue(a).localeCompare(getJobDue(b)));
  const ringR=46, circ=2*Math.PI*ringR, ringOffset=circ-(overallPct/100)*circ;
  const permits = activePermits();

  // Criticals due within the next 7 days — surfaced ABOVE everything else on Home.
  // UPCOMING ONLY: overdue criticals belong in the Critical tab's Overdue view,
  // not here, so anything dated before today is excluded.
  const crit7 = jobsAll.filter(j=>{
    if(!j.critical || getStatus(j)==='done') return false;
    const d = getJobDue(j); if(!d) return false;
    return d >= TODAY && d <= addDays(TODAY,7);
  }).sort((a,b)=> getJobDue(a).localeCompare(getJobDue(b)));

  document.getElementById('view-home').innerHTML =
    (crit7.length?
      '<div class="home-panel" style="margin:0 0 14px; border-color:var(--crit); background:var(--crit-soft);">'+
        '<h3 style="color:var(--crit);margin-bottom:10px;">⚠️ Critical — next 7 days ('+crit7.length+')</h3>'+
        crit7.slice(0,6).map(j=>{ const d=getJobDue(j);
          return '<div class="upcoming-crit-item" data-goto-daily-crit="'+d+'" style="background:var(--bg-panel);">'+
            '<span>'+esc(j.item)+' <span style="color:var(--text-faint);">· '+esc(j.machine)+'</span></span>'+
            '<span class="uc-date">'+(d===TODAY?'Today · ':'')+shortDateNoYear(d)+'</span></div>';
        }).join('')+
        (crit7.length>6?'<div style="font-size:11.5px;color:var(--crit);font-weight:700;margin-top:6px;cursor:pointer;" id="homeAllCrit">View all '+crit7.length+' criticals →</div>':'')+
      '</div>':'')+
    '<div class="progress-hero" style="margin:0 0 14px;"><div class="ph-top"><span>Today\'s Progress</span><b>'+todayPct+'%</b></div><div class="bar"><div class="fill" style="width:'+todayPct+'%"></div></div></div>'+
    '<div class="stat-strip">'+
      '<div class="stat-card" data-counter="total"><div class="num">'+s.total+'</div><div class="label">Total</div></div>'+
      '<div class="stat-card crit" data-counter="critical"><div class="num">'+s.critical+'</div><div class="label">Critical</div></div>'+
      '<div class="stat-card done" data-counter="done"><div class="num">'+s.done+'</div><div class="label">Done</div></div>'+
      '<div class="stat-card postponed" data-counter="postponed"><div class="num">'+s.postponed+'</div><div class="label">Postponed</div></div>'+
      '<div class="stat-card motor" data-counter="motor"><div class="num">'+s.motor+'</div><div class="label">Motor Starters</div></div>'+
    '</div>'+
    importantDatesPanel()+
    // PTW-06 stays collapsed (permits eat a lot of space); tapping opens the full permits window
    (permits.length?
      '<div class="home-panel" style="margin-top:14px; border-color:var(--permit);">'+
        '<div class="collapse-head" id="homePermitHead">'+
          '<h3 style="color:var(--permit);margin:0;">📋 PTW-06 Permits Pending <span class="collapse-count" style="color:var(--permit);background:var(--permit-soft);">'+permits.length+'</span></h3>'+
          '<span class="ch-chev" style="color:var(--permit);">›</span>'+
        '</div>'+
      '</div>':'')+
    '<div class="home-grid" style="margin-top:14px;">'+
      '<div class="home-panel">'+
        '<h3>Overall Completion</h3>'+
        '<div class="ring-wrap"><svg class="ring" width="110" height="110" viewBox="0 0 110 110"><circle class="ring-track" cx="55" cy="55" r="'+ringR+'"></circle><circle class="ring-fill" cx="55" cy="55" r="'+ringR+'" stroke-dasharray="'+circ+'" stroke-dashoffset="'+ringOffset+'"></circle></svg>'+
          '<div><div class="big-metric"><span class="v">'+overallPct+'%</span></div><div style="font-size:12.5px;color:var(--text-dim);margin-top:4px;">'+pending+' pending · '+s.overdue+' overdue · '+s.postponed+' postponed</div></div></div>'+
        '<h3 style="margin-top:22px;">Next 7 Days</h3><div class="mini-list">'+
          next7.map(x=>'<div class="mini-list-item" data-goto-daily="'+x.d+'"><span>'+(x.d===TODAY?'Today — ':'')+humanDate(x.d)+'</span><span class="n">'+x.cnt+' job'+(x.cnt===1?'':'s')+(x.crit?' · <span style="color:var(--crit)">'+x.crit+' crit</span>':'')+'</span></div>').join('')+
        '</div>'+
      '</div>'+
      '<div class="home-panel">'+
        '<h3>Today</h3><div class="big-metric"><span class="v">'+todayPct+'%</span><span class="l">'+todayDone+'/'+todayOccs.length+' done</span></div><div class="progress-bar-track" style="margin-top:8px;"><div class="progress-bar-fill" style="width:'+todayPct+'%"></div></div>'+
        '<h3 style="margin-top:22px;">This Month</h3><div class="big-metric"><span class="v">'+monthPct+'%</span><span class="l">'+monthDone+'/'+monthJobs.length+' done</span></div><div class="progress-bar-track" style="margin-top:8px;"><div class="progress-bar-fill" style="width:'+monthPct+'%"></div></div>'+
        '<h3 style="margin-top:22px;">Upcoming Criticals (this month)</h3>'+
        (upcomingCrit.length? upcomingCrit.slice(0,8).map(j=>'<div class="upcoming-crit-item" data-goto-daily-crit="'+getJobDue(j)+'"><span>'+esc(j.item)+' <span style="color:var(--text-faint);">· '+esc(j.machine)+'</span></span><span class="uc-date">'+shortDateNoYear(getJobDue(j))+'</span></div>').join('') : '<div style="font-size:12.5px;color:var(--text-faint);padding:8px;">No upcoming criticals this month.</div>')+
      '</div>'+
    '</div>';

  document.querySelectorAll('#view-home .stat-card').forEach(card=> card.addEventListener('click', ()=>{
    const k=card.dataset.counter;
    if(k==='motor'){ switchTab('focus'); return; }
    if(k==='critical'){ switchTab('critical'); return; }
    if(k==='done'){ switchTab('done'); return; }
    if(k==='postponed'){ switchTab('postponed'); return; }
    openCounterList(k);
  }));
  document.querySelectorAll('[data-goto-daily]').forEach(el=> el.addEventListener('click', ()=> go(()=>{ nav.date=el.dataset.gotoDaily; nav.tab='daily'; })));
  document.querySelectorAll('[data-goto-daily-crit]').forEach(el=> el.addEventListener('click', ()=> go(()=>{ nav.date=el.dataset.gotoDailyCrit; nav.tab='daily'; })));
  const ph=document.getElementById('homePermitHead'); if(ph) ph.addEventListener('click', openPermitModal);
  const ac=document.getElementById('homeAllCrit'); if(ac) ac.addEventListener('click', ()=> switchTab('critical'));
  attachPermitActions(document.getElementById('view-home'));
  attachImportantDatesHandlers();
}

/* ============================================================
   IMPORTANT DATES  (Home panel — user-added dated reminders)
   Sorted most-recent-first (descending). Each = {id, date:ISO, text}.
   ============================================================ */
function sortedImportantDates(){
  return (STATE.importantDates||[]).slice().sort((a,b)=> b.date.localeCompare(a.date) || (b.id-a.id));
}
function relDateLabel(iso){
  const diff = daysBetween(TODAY, iso);
  if(diff===0) return 'Today';
  if(diff===1) return 'Tomorrow';
  if(diff===-1) return 'Yesterday';
  if(diff>1) return 'in '+diff+' days';
  return Math.abs(diff)+' days ago';
}
/* Collapsed by default — the list can get long, so it only opens on tap. */
function importantDatesPanel(){
  const items = sortedImportantDates();   // latest date first (descending)
  const open = !!nav.impDatesOpen;
  const rows = items.length
    ? items.map(it=>{ const p=duePillParts(it.date); const yr=parseISO(it.date).getFullYear();
        return '<div class="impdate-swipe" data-impswipe="'+it.id+'">'+
            '<div class="id-swipe-bg"><span>🗑 Delete</span><span>Delete 🗑</span></div>'+
            '<div class="impdate-item" data-impid="'+it.id+'">'+
              '<div class="impdate-pill"><span class="id-day">'+p.day+'</span><span class="id-mon">'+p.mon+'</span><span class="id-yr">'+yr+'</span></div>'+
              '<div class="impdate-body"><div class="id-text">'+esc(it.text)+'</div><div class="id-rel">'+relDateLabel(it.date)+'</div></div>'+
            '</div>'+
          '</div>';
      }).join('') + '<div class="impdates-empty" style="padding:6px 4px 0;">Swipe a row left or right to delete it.</div>'
    : '<div class="impdates-empty">No important dates yet. Tap + to add an inspection, test, or any date you want to remember.</div>';
  return '<div class="impdates-panel">'+
      '<div class="impdates-head">'+
        '<div class="collapse-head'+(open?' open':'')+'" id="impdateHead" style="flex:1;">'+
          '<h3>📌 Important Dates'+(items.length?' <span class="collapse-count">'+items.length+'</span>':'')+'</h3>'+
          '<span class="ch-chev">▾</span>'+
        '</div>'+
        '<button class="impdates-add" id="impdateAddBtn" title="Add important date" style="margin-left:10px;">+</button>'+
      '</div>'+
      (open? rows : '')+
    '</div>';
}
function attachImportantDatesHandlers(){
  const add=document.getElementById('impdateAddBtn');
  if(add) add.addEventListener('click', e=>{ e.stopPropagation(); openImportantDateForm(); });
  const head=document.getElementById('impdateHead');
  if(head) head.addEventListener('click', ()=>{ nav.impDatesOpen = !nav.impDatesOpen; renderHome(); });
  // swipe left OR right on a row → confirm sheet → delete. No bare-tap delete any more.
  document.querySelectorAll('[data-impswipe]').forEach(wrap=>{
    const id = Number(wrap.dataset.impswipe);
    const row = wrap.querySelector('.impdate-item');
    const bg  = wrap.querySelector('.id-swipe-bg');
    const item = (STATE.importantDates||[]).find(x=>x.id===id);
    let startX=0,startY=0,dx=0,dragging=false,decided=false,isH=false;
    const T=70;
    const reset=()=>{ row.style.transition='transform .2s ease'; row.style.transform=''; bg.style.opacity=0; };
    row.addEventListener('touchstart', e=>{
      const t=e.touches[0]; startX=t.clientX; startY=t.clientY; dx=0;
      dragging=true; decided=false; isH=false; row.style.transition='none';
    }, {passive:true});
    row.addEventListener('touchmove', e=>{
      if(!dragging) return;
      const t=e.touches[0]; const diffX=t.clientX-startX, diffY=t.clientY-startY;
      if(!decided){ if(Math.abs(diffX)>8||Math.abs(diffY)>8){ decided=true; isH=Math.abs(diffX)>Math.abs(diffY); } }
      if(!isH) return;
      e.preventDefault(); dx=diffX;
      row.style.transform='translateX('+dx+'px)';
      bg.style.opacity=Math.min(1, Math.abs(dx)/T);
    }, {passive:false});
    row.addEventListener('touchend', ()=>{
      if(!dragging) return; dragging=false;
      const d=dx; reset();
      if(isH && Math.abs(d)>=T){
        openConfirmSheet({
          title:'Delete this important date?',
          body: item ? item.text : '',
          okLabel:'Delete',
          onOk:()=>{
            STATE.importantDates = (STATE.importantDates||[]).filter(x=>x.id!==id);
            saveState(); toast('Deleted'); renderHome();
          }
        });
      }
    });
    row.addEventListener('touchcancel', reset);
  });
}
function openImportantDateForm(){
  const root=document.getElementById('popoverRoot');
  root.innerHTML =
    '<div class="sheet-overlay" id="impOverlay"></div>'+
    '<div class="complete-sheet" id="impSheet">'+
      '<div class="cs-grip"></div>'+
      '<div class="cs-title">📌 Add Important Date</div>'+
      '<div class="impdate-form">'+
        '<div><div class="cs-sub" style="margin-top:0;">What is it?</div>'+
          '<input type="text" id="impText" maxlength="120" placeholder="e.g. Annual survey, PSC inspection, Lifeboat drill" autocomplete="off"></div>'+
      '</div>'+
      '<div class="cs-sub">Date <span style="color:var(--text-faint);font-weight:600;">(scroll ↕)</span></div>'+
      dateWheelsHtml(TODAY)+
      '<div class="cs-actions"><button class="btn" id="impCancel">Cancel</button><button class="btn primary" id="impSave">Save</button></div>'+
    '</div>';
  const close=()=>{ root.innerHTML=''; };
  document.getElementById('impOverlay').addEventListener('click', close);
  document.getElementById('impCancel').addEventListener('click', close);
  root.querySelectorAll('.wheel').forEach(setupWheel);
  setTimeout(()=>{ const t=document.getElementById('impText'); if(t) t.focus(); }, 50);
  document.getElementById('impSave').addEventListener('click', ()=>{
    const text=(document.getElementById('impText').value||'').trim();
    if(!text){ toast('Enter a description'); return; }
    const date = readDateWheels(root);
    STATE.importantDates = STATE.importantDates||[];
    STATE.importantDates.push({ id:Date.now(), date, text });
    saveState(); close(); toast('Important date added');
    nav.impDatesOpen = true;   // open the list so the new entry is visible
    renderHome();
  });
}

function openCounterList(kind){
  let jobs = visibleJobs(); let title='Total Jobs';
  if(kind==='overdue'){ jobs=jobs.filter(isOverdue); title='Overdue Jobs'; }
  jobs = jobs.slice().sort((a,b)=> getJobDue(a).localeCompare(getJobDue(b)));
  const root=document.getElementById('modalRoot');
  root.innerHTML =
    '<div class="modal-overlay" id="counterOverlay"><div class="modal-sheet" onclick="event.stopPropagation()">'+
      '<div class="modal-head"><h3>'+esc(title)+' — '+jobs.length+'</h3><button class="icon-btn" id="counterClose">✕</button></div>'+
      '<div class="job-list" id="counterJobList">'+(jobs.length? jobs.map(jobCard).join('') : '<div class="empty-state"><div class="big-icon">✓</div><div class="msg">Nothing here</div></div>')+'</div>'+
    '</div></div>';
  document.getElementById('counterOverlay').addEventListener('click', ()=>{ root.innerHTML=''; });
  document.getElementById('counterClose').addEventListener('click', ()=>{ root.innerHTML=''; });
  attachJobActions(document.getElementById('counterJobList'));
}

/* ============================================================
   VIEW: DAILY  (+ Saturday safety day)
   ============================================================ */
const NO_JOBS_QUOTES = [
  "No jobs due on this date. Enjoy your day and make your ship proud.",
  "No jobs due on this date. Take it easy — smooth seas ahead.",
  "No jobs due on this date. Enjoy your day and make your ship shine.",
];
function safetyBannerHtml(){
  if(isSaturday(nav.date)){
    if(nav.date===TODAY) return '<div class="safety-banner"><span class="sb-ic">🦺</span><span>Today is Safety Day</span></div>';
    return '<div class="safety-banner"><span class="sb-ic">🦺</span><span>Safety Day</span></div>';
  }
  // upcoming saturday hint
  const nextSat = nextSaturdayFrom(nav.date);
  const inDays = daysBetween(nav.date, nextSat);
  if(inDays>0 && inDays<=7) return '<div class="safety-banner"><span class="sb-ic">🦺</span><span>Safety Day in '+inDays+' day'+(inDays===1?'':'s')+'</span></div>';
  return '';
}
function renderDaily(){
  let occs = occurrencesOnDate(nav.date);
  occs.sort((a,b)=> dailySortKey(a.job,b.job));
  const done = occs.filter(o=>o.status==='done').length;
  const pct = occs.length? Math.round(done/occs.length*100):0;
  const isToday = nav.date===TODAY;
  const quote = NO_JOBS_QUOTES[Math.abs(nav.date.split('').reduce((a,c)=>a+c.charCodeAt(0),0))%NO_JOBS_QUOTES.length];
  document.getElementById('view-daily').innerHTML =
    // the whole day header is a swipe zone: ← next day, → previous day
    '<div class="day-nav swipe-zone" id="dayNav">'+
      '<button class="arrow-btn" id="dayPrev">‹</button>'+
      '<div class="day-label">'+
        '<span class="dl-date">'+shortDate(nav.date)+'</span>'+
        '<span class="sub">'+(isToday?'Today':(parseISO(nav.date)<parseISO(TODAY)? Math.abs(daysBetween(nav.date,TODAY))+' days ago':'in '+daysBetween(TODAY,nav.date)+' days'))+'</span>'+
        // "Today" lives inside the centred label so it can't be hit while tapping ›
        (!isToday?'<button class="today-btn" id="dayToday">⤺ Today</button>':'')+
      '</div>'+
      '<button class="arrow-btn" id="dayNext">›</button>'+
    '</div>'+
    '<div class="swipe-hint">‹ swipe the date bar to change day ›</div>'+
    safetyBannerHtml()+
    '<div class="progress-bar-wrap"><div class="progress-bar-track"><div class="progress-bar-fill" style="width:'+pct+'%"></div></div><div class="progress-pct">'+pct+'%</div></div>'+
    '<div class="job-list" id="dailyJobList">'+(occs.length? occs.map(o=>jobCard(o.job,{occDate:o.date, occStatus:o.status})).join('') : '<div class="empty-state"><div class="big-icon">⚓</div><div class="msg">'+quote+'</div></div>')+'</div>';
  document.getElementById('dayPrev').addEventListener('click', ()=>navDay(-1));
  document.getElementById('dayNext').addEventListener('click', ()=>navDay(1));
  const tb=document.getElementById('dayToday'); if(tb) tb.addEventListener('click', ()=> go(()=>{ nav.date=TODAY; }));
  // swipe the date bar itself (empty space around the date) to change day
  attachHSwipe(document.getElementById('dayNav'), ()=>navDay(1), ()=>navDay(-1),
               { ignoreSelector:'.arrow-btn, .today-btn' });
  attachJobActions(document.getElementById('dailyJobList'));
}
function navDay(delta){ go(()=>{ nav.date=addDays(nav.date,delta); }); }

/* ============================================================
   VIEW: WEEKLY (unique weekly jobs)
   ============================================================ */
function renderWeekly(){
  const jobs = sortJobs(visibleJobs().filter(isWeekly));
  const overdue = jobs.filter(isOverdue).length;
  const done = jobs.filter(j=>getStatus(j)==='done').length;
  document.getElementById('view-weekly').innerHTML =
    '<div class="section-title">🔁 Weekly Jobs — '+jobs.length+'</div>'+
    '<div class="stat-strip" style="grid-template-columns:repeat(3,1fr);">'+
      '<div class="stat-card done"><div class="num">'+done+'</div><div class="label">Done</div></div>'+
      '<div class="stat-card overdue"><div class="num">'+overdue+'</div><div class="label">Overdue</div></div>'+
      '<div class="stat-card"><div class="num">'+(jobs.length-done)+'</div><div class="label">Pending</div></div>'+
    '</div>'+
    '<div class="job-list" id="weeklyJobList" style="margin-top:14px;">'+(jobs.length? jobs.map(j=>jobCard(j,{noDate:true})).join('') : '<div class="empty-state"><div class="big-icon">🔁</div><div class="msg">No weekly jobs</div></div>')+'</div>';
  attachJobActions(document.getElementById('weeklyJobList'));
}

/* ============================================================
   VIEW: STATUS LIST (Done desc, Postponed)
   ============================================================ */
/* Build occurrence records from STATE.statuses. Each = {job, occDue, doneDate}. */
function statusOccurrences(kind){
  const out=[];
  const byId = new Map(RAW.map(j=>[j.id,j]));
  Object.keys(STATE.statuses).forEach(key=>{
    if(STATE.statuses[key]!==kind) return;
    const at = key.lastIndexOf('@'); if(at<0) return;
    const id = Number(key.slice(0,at)); const occDue = key.slice(at+1);
    const job = byId.get(id); if(!job) return;
    if(STATE.signOffDate && occDue > STATE.signOffDate) return;
    const meta = STATE.jobMeta[key];
    out.push({ job, occDue, doneDate: (meta&&meta.doneDate)||occDue, key,
               postponedTo: (STATE.postponedUntil||{})[key] || null });
  });
  return out;
}
/* render a job card for a fixed occurrence (Done/Postponed lists) */
function occurrenceCard(occ, kind){
  const job = occ.job;
  const dateShown = kind==='done' ? occ.doneDate : (occ.postponedTo || occ.occDue);
  const dp = duePillParts(dateShown);
  const cls = ['job-card', kind==='done'?'is-done':'is-postponed'];
  const pillCls = kind==='done'?'done':'overdue';
  const icls = intervalColorClass(job.interval);
  const corner = kind==='done' ? '<div class="corner-tag done">Completed</div>' : '<div class="corner-tag postp">Postponed</div>';
  const extraTag = kind==='done'
    ? '<span class="tag interval-grey">Done '+shortDateNoYear(occ.doneDate)+'</span>'
    : (occ.postponedTo ? '<span class="tag interval-blue">→ '+shortDateNoYear(occ.postponedTo)+'</span>' : '');
  const actions = kind==='done'
    ? '<div class="job-actions">'+
        '<button class="act-btn complete" data-occ-editdate="'+occ.key+'" data-job-id="'+job.id+'" title="Change done date">📅</button>'+
        '<button class="act-btn undo" data-occ-undo="'+occ.key+'" data-job-id="'+job.id+'" title="Undo">↺</button></div>'
    : '<div class="job-actions">'+
        '<button class="act-btn postpone" data-occ-editdate="'+occ.key+'" data-job-id="'+job.id+'" title="Change postponed date">📅</button>'+
        '<button class="act-btn undo" data-occ-undo="'+occ.key+'" data-job-id="'+job.id+'" title="Undo">↺</button></div>';
  const front =
    '<div class="'+cls.join(' ')+'" data-occ-key="'+occ.key+'" data-job-id="'+job.id+'">'+
      corner+
      '<div class="due-pill '+pillCls+'"><span class="dp-day">'+dp.day+'</span><span class="dp-mon">'+dp.mon+'</span></div>'+
      '<div class="job-info">'+
        '<div class="job-title">'+esc(job.item)+'</div>'+
        '<div class="job-work">Work — <span>'+esc(displayWork(job))+'</span></div>'+
        '<div class="job-sub">'+esc(job.system)+' · '+esc(job.machine)+'</div>'+
        '<div class="job-tags">'+
          '<span class="tag '+icls+'">'+esc(intervalLabel(job.interval))+'</span>'+
          (job.critical?'<span class="tag crit">Critical</span>':'')+
          extraTag+
        '</div>'+
      '</div>'+
      actions+
    '</div>';
  return '<div class="job-flip" data-occ-kind="'+kind+'" data-occ-key="'+occ.key+'" data-job-id="'+job.id+'">'+
      '<div class="job-swipe-wrap">'+
        '<div class="swipe-bg right">📅 Change date</div>'+
        '<div class="swipe-bg left">↺ Undo</div>'+
        '<div class="flip-inner">'+front+'</div>'+
      '</div>'+
    '</div>';
}

/* Re-pick the date of an already done / postponed occurrence.
   Done  → moves the recorded done date AND re-bases the next due date.
   Postp → moves the date the job is postponed to. */
function editOccurrenceDate(key, kind){
  const at = key.lastIndexOf('@'); if(at<0) return;
  const id = Number(key.slice(0,at));
  const job = RAW.find(j=>j.id===id); if(!job) return;
  const meta = STATE.jobMeta[key];
  const current = kind==='done'
    ? ((meta && meta.doneDate) || key.slice(at+1))
    : ((STATE.postponedUntil||{})[key] || key.slice(at+1));
  openDatePickerSheet({
    title: (kind==='done'?'Change done date — ':'Change postponed date — ')+job.item,
    initial: current,
    okLabel: 'Save',
    note: kind==='done' ? '📅 The next due date is recalculated from this date.' : '',
    onOk: (iso)=>{
      if(kind==='done'){
        STATE.jobMeta[key] = Object.assign({}, meta, { doneDate: iso });
        STATE.lastDone = STATE.lastDone || {};
        STATE.lastDone[id] = iso;
        // re-base the next occurrence off the corrected done date
        if(isHoursJob(job)){
          recomputeHoursDue();
        } else {
          const months = intervalToMonths(job.interval);
          if(months) STATE.jobDueOverride[id] = addMonthsISO(iso, months);
        }
        // keep any raised permit in step with the corrected date
        const pid='P'+id;
        if(STATE.permits[pid]){ STATE.permits[pid].doneDate = iso; STATE.permits[pid].due = iso; }
      } else {
        STATE.postponedUntil = STATE.postponedUntil || {};
        STATE.postponedUntil[key] = iso;
      }
      saveState(); toast('Date updated'); refreshAll();
    }
  });
}

/* Undo a done/postponed occurrence back to pending (shared by button + swipe). */
function undoOccurrence(key, kind){
  const at = key.lastIndexOf('@'); if(at<0) return;
  const id = Number(key.slice(0,at));
  setStatusForKey(key, null);
  delete STATE.jobMeta[key];
  if(STATE.postponedUntil) delete STATE.postponedUntil[key];
  const job = RAW.find(j=>j.id===id);
  if(job && kind==='done'){
    delete STATE.jobDueOverride[id];
    if(STATE.lastDone) delete STATE.lastDone[id];
    const pid='P'+id; if(STATE.permits[pid]) delete STATE.permits[pid];
    if(isHoursJob(job)){ delete STATE.hoursJobBase[id]; recomputeHoursDue(); }
  }
  saveState(); toast('Status cleared'); updatePermitBell(); renderCurrentView();
}

/* Swipe on Done/Postponed cards: right → change date, left → undo (confirmed). */
function attachOccurrenceSwipe(scope){
  scope.querySelectorAll('.job-flip[data-occ-key]').forEach(flip=>{
    const wrap = flip.querySelector('.job-swipe-wrap');
    const inner = flip.querySelector('.flip-inner');
    const card = flip.querySelector('.job-card');
    const bgRight = wrap.querySelector('.swipe-bg.right');
    const bgLeft  = wrap.querySelector('.swipe-bg.left');
    const key = flip.dataset.occKey, kind = flip.dataset.occKind;
    let startX=0,startY=0,dx=0,dragging=false,decided=false,isH=false;
    const T=80;
    const resetPos=()=>{ inner.style.transition='transform .2s ease'; inner.style.transform=''; bgRight.style.opacity=0; bgLeft.style.opacity=0; };

    card.addEventListener('touchstart', e=>{
      if(e.target.closest('.act-btn')) return;
      const t=e.touches[0]; startX=t.clientX; startY=t.clientY; dx=0;
      dragging=true; decided=false; isH=false; inner.style.transition='none';
    }, {passive:true});
    card.addEventListener('touchmove', e=>{
      if(!dragging) return;
      const t=e.touches[0]; const diffX=t.clientX-startX, diffY=t.clientY-startY;
      if(!decided){ if(Math.abs(diffX)>8||Math.abs(diffY)>8){ decided=true; isH=Math.abs(diffX)>Math.abs(diffY); } }
      if(!isH) return;
      e.preventDefault(); dx=diffX; inner.style.transform='translateX('+dx+'px)';
      if(dx>0){ bgRight.style.opacity=Math.min(1,dx/T); bgLeft.style.opacity=0; }
      else { bgLeft.style.opacity=Math.min(1,-dx/T); bgRight.style.opacity=0; }
    }, {passive:false});
    card.addEventListener('touchend', ()=>{
      if(!dragging) return; dragging=false;
      const d=dx; resetPos();
      if(isH && Math.abs(d)>=T){
        if(d>0) editOccurrenceDate(key, kind);
        else openConfirmSheet({ title:'Undo this '+(kind==='done'?'completion':'postponement')+'?',
                                body:'The job goes back to pending.', okLabel:'Undo',
                                onOk:()=> undoOccurrence(key, kind) });
      }
    });
    card.addEventListener('touchcancel', resetPos);
  });
}
function renderStatusList(kind){
  let occ = statusOccurrences(kind);
  if(kind==='done') occ.sort((a,b)=> b.doneDate.localeCompare(a.doneDate));   // latest done first
  else occ.sort((a,b)=> (a.postponedTo||a.occDue).localeCompare(b.postponedTo||b.occDue));
  const view=document.getElementById('view-'+kind);
  const title = kind==='done'? '✅ Completed Jobs' : '⏸️ Postponed Jobs';
  const icon = kind==='done'? '✓' : '⏸';
  const emptyMsg = kind==='done'? 'Nothing completed yet' : 'Nothing postponed';
  view.innerHTML =
    '<div class="section-title">'+title+' — '+occ.length+'</div>'+
    '<div class="job-list" id="'+kind+'JobList">'+(occ.length? occ.map(o=>occurrenceCard(o,kind)).join('') : '<div class="empty-state"><div class="big-icon">'+icon+'</div><div class="msg">'+emptyMsg+'</div></div>')+'</div>';
  // undo handlers (clear that specific occurrence) — confirmed, never a bare tap
  view.querySelectorAll('[data-occ-undo]').forEach(btn=> btn.addEventListener('click', e=>{
    e.stopPropagation();
    const key=btn.dataset.occUndo;
    openConfirmSheet({ title:'Undo this '+(kind==='done'?'completion':'postponement')+'?',
                       body:'The job goes back to pending.', okLabel:'Undo',
                       onOk:()=> undoOccurrence(key, kind) });
  }));
  // change the recorded done / postponed-to date
  view.querySelectorAll('[data-occ-editdate]').forEach(btn=> btn.addEventListener('click', e=>{
    e.stopPropagation(); editOccurrenceDate(btn.dataset.occEditdate, kind);
  }));
  attachOccurrenceSwipe(view);
}

/* ============================================================
   VIEW: MONTHLY
   ============================================================ */
/* Month keys are 'YYYY-MM'. Anything else (a job with a blank or unparseable
   due date) is dropped here so a single bad CSV row can never blank the view. */
function isMonthKey(m){ return /^\d{4}-\d{2}$/.test(m); }
function monthBuckets(){ return Array.from(new Set(visibleJobs().map(j=>getJobDue(j).slice(0,7)))).filter(isMonthKey).sort(); }
function allDataMonths(){ return Array.from(new Set(RAW.map(j=>getJobDue(j).slice(0,7)))).filter(isMonthKey).sort(); }
function renderMonth(){
  if(nav.monthBucket){ renderMonthDetail(nav.monthBucket); return; }
  const months=monthBuckets(); const hidden = STATE.signOffDate && allDataMonths().length>months.length;
  document.getElementById('view-month').innerHTML =
    '<div class="section-title">🗓️ Monthly Overview</div><div class="month-tile-grid">'+
      months.map(m=>{ const jobs=visibleJobs().filter(j=>getJobDue(j).slice(0,7)===m); const crit=jobs.filter(j=>j.critical).length; const [y,mo]=m.split('-').map(Number);
        return '<div class="month-tile" data-month="'+m+'" tabindex="0">'+(crit?'<div class="mt-crit">'+crit+'</div>':'')+'<div class="mt-mon">'+MON[mo-1].slice(0,3)+'</div><div class="mt-year">'+y+'</div><div class="mt-jobs">'+jobs.length+'<small>jobs</small></div></div>';
      }).join('')+
    '</div>'+(hidden?'<div class="signoff-msg">Change your sign-off month in Settings to see more.</div>':'');
  document.querySelectorAll('.month-tile').forEach(el=>{ const g=()=> go(()=>{ nav.monthBucket=el.dataset.month; }); el.addEventListener('click', g); el.addEventListener('keydown', e=>{ if(e.key==='Enter') g(); }); });
}
function renderMonthDetail(m){
  const jobs = sortJobs(visibleJobs().filter(j=>getJobDue(j).slice(0,7)===m));
  const [y,mo]=m.split('-').map(Number); const label=MON[mo-1]+' '+y;
  const daysInMonth=new Date(y,mo,0).getDate(); const firstDow=new Date(y,mo-1,1).getDay();
  const jobsByDay={}; jobs.forEach(j=>{ const day=Number(getJobDue(j).slice(8,10)); (jobsByDay[day]=jobsByDay[day]||[]).push(j); });
  let cells=''; for(let i=0;i<firstDow;i++) cells+='<div class="cal-cell empty"></div>';
  for(let d=1;d<=daysInMonth;d++){
    const dj=jobsByDay[d]||[]; const crit=dj.filter(j=>j.critical).length;
    const iso=y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const cls=['cal-cell']; if(dj.length)cls.push('has-jobs'); if(crit)cls.push('has-crit'); if(iso===TODAY)cls.push('is-today'); if(isSaturday(iso))cls.push('is-saturday');
    cells+='<div class="'+cls.join(' ')+'" data-date="'+iso+'" tabindex="'+(dj.length?0:-1)+'" style="'+(dj.length?'cursor:pointer;':'cursor:default;')+'">'+
      '<span class="d-num">'+d+'</span>'+
      '<span class="cal-tile-info">'+(dj.length? dj.length+' job'+(dj.length===1?'':'s') : '—')+(crit?' · '+crit+' crit':'')+'</span>'+
      (dj.length?'<span class="cal-count-badge">'+dj.length+'</span>':'')+
      (crit?'<span class="cal-crit-badge">'+crit+'</span>':'')+
    '</div>';
  }
  const months = monthBuckets(); const mi = months.indexOf(m);
  const prevM = mi>0 ? months[mi-1] : null, nextM = (mi>=0 && mi<months.length-1) ? months[mi+1] : null;
  const monLabel = (b)=>{ const [yy,mm]=b.split('-').map(Number); return MON[mm-1].slice(0,3)+' '+yy; };
  document.getElementById('view-month').innerHTML =
    '<div class="breadcrumb"><a data-back>← All months</a></div>'+
    '<div class="day-nav">'+
      '<button class="arrow-btn" id="monthPrev"'+(prevM?'':' disabled style="opacity:.35;"')+'>‹</button>'+
      '<div class="day-label"><span class="dl-date">'+label+'</span>'+
        '<span class="sub">'+jobs.length+' job'+(jobs.length===1?'':'s')+(jobs.filter(j=>j.critical).length?' · '+jobs.filter(j=>j.critical).length+' critical':'')+'</span></div>'+
      '<button class="arrow-btn" id="monthNext"'+(nextM?'':' disabled style="opacity:.35;"')+'>›</button>'+
    '</div>'+
    '<div class="swipe-hint">'+(prevM?'‹ '+monLabel(prevM):'')+' &nbsp;·&nbsp; swipe the calendar &nbsp;·&nbsp; '+(nextM?monLabel(nextM)+' ›':'')+'</div>'+
    // wrapper is the swipe target: dragging anywhere in the grid's empty space works
    '<div class="swipe-zone" id="monthSwipe">'+
      (jobs.length?'<div class="cal-grid">'+DOW.map(d=>'<div class="cal-dow">'+d+'</div>').join('')+cells+'</div>':'<div class="empty-state"><div class="big-icon">⚓</div><div class="msg">No jobs scheduled this month</div></div>')+
    '</div>';
  const mp=document.getElementById('monthPrev'); if(mp) mp.addEventListener('click', ()=>navMonth(-1));
  const mn=document.getElementById('monthNext'); if(mn) mn.addEventListener('click', ()=>navMonth(1));
  document.querySelector('[data-back]').addEventListener('click', ()=> go(()=>{ nav.monthBucket=null; }));
  document.querySelectorAll('.cal-cell.has-jobs[data-date]').forEach(el=>{ const g=()=>openDayModal(el.dataset.date); el.addEventListener('click', g); el.addEventListener('keydown', e=>{ if(e.key==='Enter') g(); }); });
  // swipe the calendar (its gaps / empty cells) to walk to the next / previous month
  attachHSwipe(document.getElementById('monthSwipe'), ()=>navMonth(1), ()=>navMonth(-1),
               { ignoreSelector:'.cal-cell.has-jobs' });
}
/* Step to the adjacent month that actually has jobs; wraps at the ends. */
function navMonth(delta){
  const months = monthBuckets();
  if(months.length<2) return;
  const i = months.indexOf(nav.monthBucket);
  if(i<0) return;
  const next = i + delta;
  if(next<0 || next>=months.length){ toast(delta>0?'No later months':'No earlier months'); return; }
  go(()=>{ nav.monthBucket = months[next]; });
}
/* Month -> day: a real navigation entry so back returns to month-detail */
function openDayModal(iso){
  go(()=>{ nav.date=iso; nav.__dayModal=iso; });
}
/* render the day modal when nav.__dayModal is set (called from renderMonth path via render) */
/* Simpler: openDayModal shows a modal but ALSO records history so back closes it. */

/* We implement day view as a modal but tie it to history via a lightweight flag. */
function showDayModalNow(iso){
  const occs = occurrencesOnDate(iso).sort((a,b)=> dailySortKey(a.job,b.job));
  const root=document.getElementById('modalRoot');
  root.innerHTML =
    '<div class="modal-overlay" id="dayOverlay"><div class="modal-sheet" onclick="event.stopPropagation()">'+
      '<div class="modal-head"><h3>'+humanDate(iso)+'</h3><button class="icon-btn" id="dayClose">✕</button></div>'+
      // the day header inside the sheet is a swipe zone: ← next day, → previous day
      '<div class="day-nav swipe-zone" id="dayModalNav" style="margin-bottom:8px;">'+
        '<button class="arrow-btn" id="dayModalPrev">‹</button>'+
        '<div class="day-label"><span class="dl-date">'+shortDate(iso)+'</span>'+
          '<span class="sub">'+occs.length+' job'+(occs.length===1?'':'s')+' · swipe to change day</span></div>'+
        '<button class="arrow-btn" id="dayModalNext">›</button>'+
      '</div>'+
      (isSaturday(iso)? '<div class="safety-banner" style="margin-bottom:12px;"><span class="sb-ic">🦺</span><span>'+(iso===TODAY?'Today is Safety Day':'Safety Day')+'</span></div>':'')+
      '<div class="job-list" id="dayJobList">'+(occs.length? occs.map(o=>jobCard(o.job,{occDate:o.date, occStatus:o.status})).join('') : '<div class="empty-state"><div class="big-icon">⚓</div><div class="msg">No jobs due on this date.</div></div>')+'</div>'+
    '</div></div>';
  const close=()=>{ history.back(); };   // routed through popstate → pops to month-detail
  document.getElementById('dayOverlay').addEventListener('click', close);
  document.getElementById('dayClose').addEventListener('click', close);
  // step the modal to another day in place (no extra history entry per day)
  const step=(delta)=>{ const to=addDays(iso,delta); nav.date=to; nav.__dayModal=to; showDayModalNow(to); };
  document.getElementById('dayModalPrev').addEventListener('click', ()=>step(-1));
  document.getElementById('dayModalNext').addEventListener('click', ()=>step(1));
  attachHSwipe(document.getElementById('dayModalNav'), ()=>step(1), ()=>step(-1),
               { ignoreSelector:'.arrow-btn' });
  attachJobActions(document.getElementById('dayJobList'));
}

/* ============================================================
   VIEW: CRITICAL
   ============================================================ */
function renderCritical(){
  const allCrit = sortJobs(visibleJobs().filter(j=>j.critical));
  const months = Array.from(new Set(allCrit.map(j=>getJobDue(j).slice(0,7)))).filter(isMonthKey).sort();
  const jobs = nav.critMonth==='all'? allCrit : allCrit.filter(j=>getJobDue(j).slice(0,7)===nav.critMonth);
  const done=jobs.filter(j=>getStatus(j)==='done').length; const overdue=jobs.filter(isOverdue).length; const pct=jobs.length?Math.round(done/jobs.length*100):0;
  // the stat tiles double as filters: tap Done / Overdue to narrow the list, tap again to clear
  const f = nav.critFilter||'all';
  const shown = f==='done'    ? jobs.filter(j=>getStatus(j)==='done')
              : f==='overdue' ? jobs.filter(isOverdue)
              : jobs;
  const filterNote = f==='all' ? '' :
    '<div class="filter-note" id="critFilterNote">Showing '+(f==='done'?'completed':'overdue')+' only · tap to clear ✕</div>';
  document.getElementById('view-critical').innerHTML =
    '<div class="section-title" style="color:var(--crit);">⚠️ Critical Jobs — '+allCrit.length+'</div>'+
    '<div class="pill-row" id="critMonthBar"><button class="filter-pill crit-variant '+(nav.critMonth==='all'?'active':'')+'" data-cm="all">All Critical</button>'+
      months.map(m=>{ const [y,mo]=m.split('-').map(Number); return '<button class="filter-pill crit-variant '+(nav.critMonth===m?'active':'')+'" data-cm="'+m+'">'+MON[mo-1].slice(0,3)+' '+y+'</button>'; }).join('')+'</div>'+
    '<div class="stat-strip" style="grid-template-columns:repeat(3,1fr); margin-bottom:12px;">'+
      '<div class="stat-card done tappable'+(f==='done'?' picked':'')+'" data-critfilter="done"><div class="num">'+done+'</div><div class="label">Done</div></div>'+
      '<div class="stat-card overdue tappable'+(f==='overdue'?' picked':'')+'" data-critfilter="overdue"><div class="num">'+overdue+'</div><div class="label">Overdue</div></div>'+
      '<div class="stat-card crit tappable'+(f==='all'?' picked':'')+'" data-critfilter="all"><div class="num">'+pct+'%</div><div class="label">Progress</div></div></div>'+
    filterNote+
    '<div class="job-list" id="critJobList">'+(shown.length? shown.map(jobCard).join('') : '<div class="empty-state"><div class="big-icon">✓</div><div class="msg">No critical jobs here</div></div>')+'</div>';
  document.querySelectorAll('#critMonthBar .filter-pill').forEach(btn=> btn.addEventListener('click', ()=>{ nav.critMonth=btn.dataset.cm; renderCritical(); }));
  document.querySelectorAll('#view-critical [data-critfilter]').forEach(card=> card.addEventListener('click', ()=>{
    const want = card.dataset.critfilter;
    nav.critFilter = (nav.critFilter===want && want!=='all') ? 'all' : want;   // tapping the active tile clears it
    renderCritical();
  }));
  const fn=document.getElementById('critFilterNote'); if(fn) fn.addEventListener('click', ()=>{ nav.critFilter='all'; renderCritical(); });
  attachJobActions(document.getElementById('critJobList'));
}

/* ============================================================
   VIEW: FOCUS (Motor Starters)
   ============================================================ */
function renderFocus(){
  const jobs = visibleJobs().filter(isFocusJob);
  const months = Array.from(new Set(jobs.map(j=>getJobDue(j).slice(0,7)))).filter(isMonthKey).sort();
  if(!nav.focusMonth || !months.includes(nav.focusMonth)) nav.focusMonth = months[0];
  const monthJobs = sortJobs(jobs.filter(j=>getJobDue(j).slice(0,7)===nav.focusMonth));
  const permits = activePermits();
  document.getElementById('view-focus').innerHTML =
    '<div class="section-title">⚙️ Motor Starters — '+jobs.length+'</div>'+
    // collapsed by default — tapping opens the dedicated PTW-06 permits window
    (permits.length?
      '<div class="home-panel" style="margin-bottom:14px; border-color:var(--permit);">'+
        '<div class="collapse-head" id="focusPermitHead">'+
          '<h3 style="color:var(--permit);margin:0;">📋 PTW-06 Permits <span class="collapse-count" style="color:var(--permit);background:var(--permit-soft);">'+permits.length+' pending</span></h3>'+
          '<span class="ch-chev" style="color:var(--permit);">›</span>'+
        '</div>'+
      '</div>':'')+
    '<div class="pill-row">'+ (months.length? months.map(m=>{ const cnt=jobs.filter(j=>getJobDue(j).slice(0,7)===m).length; const [y,mo]=m.split('-').map(Number); return '<button class="filter-pill '+(m===nav.focusMonth?'active':'')+'" data-fm="'+m+'">'+MON[mo-1].slice(0,3)+' '+y+' <span class="cnt">'+cnt+'</span></button>'; }).join('') : '') +'</div>'+
    '<div class="job-list" id="focusJobList">'+(monthJobs.length? monthJobs.map(jobCard).join('') : '<div class="empty-state"><div class="big-icon">⚙️</div><div class="msg">No motor-starter routines'+(months.length?' this month':'')+'</div></div>')+'</div>';
  const ph=document.getElementById('focusPermitHead'); if(ph) ph.addEventListener('click', openPermitModal);
  document.querySelectorAll('#view-focus .filter-pill').forEach(el=> el.addEventListener('click', ()=>{ nav.focusMonth=el.dataset.fm; renderFocus(); }));
  attachJobActions(document.getElementById('focusJobList'));
  attachPermitActions(document.getElementById('view-focus'));
}

/* ============================================================
   VIEW: MACHINES
   ============================================================ */
function renderMachines(){
  if(nav.system && nav.machine){ renderMachineDetail(nav.system,nav.machine); return; }
  if(nav.system){ renderMachineList(nav.system); return; }
  renderSystemList();
}
function renderSystemList(){
  const systems={};
  visibleJobs().forEach(j=>{ if(!systems[j.system]) systems[j.system]={count:0,crit:0}; systems[j.system].count++; if(j.critical)systems[j.system].crit++; });
  const names=Object.keys(systems).sort();
  document.getElementById('view-machines').innerHTML =
    '<div class="section-title">🔧 Systems ('+names.length+')</div><div class="system-grid" id="systemGrid">'+
      names.map(n=>'<div class="system-card" data-sys="'+esc(n)+'" tabindex="0"><div class="s-name">'+esc(n)+'</div><div class="s-stats"><span class="s-count">'+systems[n].count+'</span><span class="s-label">jobs</span></div>'+(systems[n].crit?'<div class="s-crit">'+systems[n].crit+' critical</div>':'')+'</div>').join('')+
    '</div>';
  document.querySelectorAll('.system-card').forEach(el=>{ const g=()=> go(()=>{ nav.system=el.dataset.sys; nav.machine=null; }); el.addEventListener('click', g); el.addEventListener('keydown', e=>{ if(e.key==='Enter') g(); }); });
}
function renderMachineList(system){
  const machines={};
  RAW.filter(j=>j.system===system).forEach(j=>{ if(!machines[j.machine]) machines[j.machine]={count:0,crit:0,lastDone:null}; machines[j.machine].count++; if(j.critical)machines[j.machine].crit++; if(j.done&&(!machines[j.machine].lastDone||j.done>machines[j.machine].lastDone)) machines[j.machine].lastDone=j.done; });
  const names=Object.keys(machines).sort();
  document.getElementById('view-machines').innerHTML =
    '<div class="breadcrumb"><a data-back-sys>← Systems</a> <span>/</span> <span>'+esc(system)+'</span></div><div class="section-title">'+esc(system)+'</div><div class="machine-grid">'+
      names.map(n=>'<div class="machine-tile" data-mach="'+esc(n)+'" tabindex="0">'+
        '<div class="mt-name">'+(machines[n].crit?'<span class="mt-crit-dot"></span>':'')+esc(n)+'</div>'+
        '<div class="mt-stat"><div class="mt-k">Total Jobs</div><div class="mt-v">'+machines[n].count+'</div></div>'+
        '<div class="mt-stat"><div class="mt-k">Last Maintenance</div><div class="mt-v last">'+(machines[n].lastDone?shortDate(machines[n].lastDone):'No record')+'</div></div>'+
      '</div>').join('')+
    '</div>';
  document.querySelector('[data-back-sys]').addEventListener('click', ()=> go(()=>{ nav.system=null; }));
  document.querySelectorAll('.machine-tile').forEach(el=>{ const g=()=> go(()=>{ nav.machine=el.dataset.mach; }); el.addEventListener('click', g); el.addEventListener('keydown', e=>{ if(e.key==='Enter') g(); }); });
}
function machineJobLastDone(j){ return (STATE.lastDone && STATE.lastDone[j.id]) || j.done || ''; }
function renderMachineDetail(system,machine){
  const jobs=sortJobs(RAW.filter(j=>j.system===system&&j.machine===machine));
  const crit=jobs.filter(j=>j.critical).length;
  // find the single most-recently maintained job (to tag it)
  let recentJob=null, recentDate='';
  jobs.forEach(j=>{ const d=machineJobLastDone(j); if(d && d>recentDate){ recentDate=d; recentJob=j; } });
  const lastDone = recentDate || null;
  document.getElementById('view-machines').innerHTML =
    '<div class="breadcrumb"><a data-back-sys>← Systems</a> <span>/</span> <a data-back-mach>'+esc(system)+'</a> <span>/</span> <span>'+esc(machine)+'</span></div><div class="section-title">'+esc(machine)+'</div>'+
    '<div class="stat-strip" style="grid-template-columns:repeat(3,1fr); margin-bottom:16px;"><div class="stat-card"><div class="num">'+jobs.length+'</div><div class="label">Total</div></div><div class="stat-card crit"><div class="num">'+crit+'</div><div class="label">Critical</div></div><div class="stat-card"><div class="num" style="font-size:14px;">'+(lastDone?shortDate(lastDone):'—')+'</div><div class="label">Last Maint.</div></div></div>'+
    '<div class="job-list" id="machDetailList">'+jobs.map(j=>jobCard(j,{ noStatusCorner:true, lastMaint:(recentJob&&j.id===recentJob.id) })).join('')+'</div>';
  document.querySelector('[data-back-sys]').addEventListener('click', ()=> go(()=>{ nav.system=null; nav.machine=null; }));
  document.querySelector('[data-back-mach]').addEventListener('click', ()=> go(()=>{ nav.machine=null; }));
  attachJobActions(document.getElementById('machDetailList'));
}

/* ============================================================
   VIEW: RUNNING HOURS  (own section — pill menu ⏱️)
   The user enters how many NEW hours a machine has run since the last update.
   Those hours add to every hours-job on the machine. Each job's accumulated
   hours = its CSV base + the machine's total added hours (minus any reset), and
   the job becomes DUE the moment that reaches its interval. A due job can be
   completed right here (swipe or tap Done), which resets that job's counter
   to 0 while the machine keeps climbing. The bars preview live as you type.
   ============================================================ */
function rhJobLine(j){
  const iv=intervalHours(j.interval)||0; const acc=jobAccumHours(j);
  const due = STATE.hoursDueDate[j.id];
  const pct = iv? Math.min(100, Math.round(acc/iv*100)) : 0;
  const stateCls = due? 'rh-due' : (pct>=80?'rh-soon':'');
  return '<div class="rh-job '+stateCls+'" data-rh-job="'+j.id+'">'+
      '<div class="rh-job-main">'+
        '<div class="rh-job-name">'+esc(j.item)+'</div>'+
        '<div class="rh-job-meter"><div class="rh-meter-track"><div class="rh-meter-fill" style="width:'+pct+'%"></div></div>'+
          '<span class="rh-job-num">'+acc.toLocaleString()+' / '+iv.toLocaleString()+' h</span></div>'+
        (due? '<span class="rh-badge">DUE '+shortDateNoYear(due)+'</span>' : '<span class="rh-remain">'+Math.max(0,iv-acc).toLocaleString()+' h left</span>')+
      '</div>'+
      (due? '<button class="rh-done-btn" data-rh-done="'+j.id+'" aria-label="Mark done">✓ Done</button>' : '')+
    '</div>';
}
function renderRunningHours(){
  const machines = hoursMachines();
  const view = document.getElementById('view-runninghours');
  if(!machines.length){
    view.innerHTML =
      '<div class="section-title">⏱️ Running Hours</div>'+
      '<div class="empty-state"><div class="big-icon">⏱️</div><div class="msg">No running-hours jobs</div>'+
      '<div class="sub">Jobs with an hours interval (e.g. 2000 H) will appear here once imported.</div></div>';
    return;
  }
  const rows = machines.map(mc=>{
    const added = machineAdded(mc.key);
    const jobLines = mc.jobs.slice().sort((a,b)=>(intervalHours(a.interval)||0)-(intervalHours(b.interval)||0)).map(rhJobLine).join('');
    return '<div class="rh-machine" data-rh-machine="'+esc(mc.key)+'">'+
        '<div class="rh-head"><div class="rh-mname">'+esc(mc.machine)+'</div><div class="rh-sys">'+esc(mc.system)+'</div></div>'+
        '<div class="rh-input-row">'+
          '<label>Add running hours (new hours since last update)</label>'+
          '<div class="rh-input-line">'+
            '<input type="number" inputmode="numeric" min="0" step="1" class="rh-input" data-mkey="'+esc(mc.key)+'" value="" placeholder="e.g. 40">'+
            '<button class="btn primary rh-save" data-mkey="'+esc(mc.key)+'">Add</button>'+
          '</div>'+
        '</div>'+
        '<div class="rh-preview" data-rh-preview="'+esc(mc.key)+'" style="display:none;"></div>'+
        '<div class="rh-current" data-rh-total="'+esc(mc.key)+'">Total running hours added: <b>'+added.toLocaleString()+' h</b></div>'+
        '<div class="rh-jobs" data-rh-joblist="'+esc(mc.key)+'">'+jobLines+'</div>'+
      '</div>';
  }).join('');
  view.innerHTML =
    '<div class="section-title">⏱️ Running Hours</div>'+
    '<p style="font-size:12.5px; color:var(--text-dim); margin:-6px 0 14px;">Enter how many <b>new hours</b> each machine has run since you last updated it. Those hours add to the total below, and every hours-based job advances by that much — becoming due automatically once it reaches its interval. Complete a due job here to reset just that job to zero.</p>'+
    '<div class="rh-list">'+rows+'</div>';
  attachRunningHoursHandlers(view, machines);
}
function attachRunningHoursHandlers(view, machines){
  const byKey = new Map(machines.map(m=>[m.key,m]));
  function renderSavedJobs(mc){
    const listEl = view.querySelector('.rh-jobs[data-rh-joblist="'+CSS.escape(mc.key)+'"]');
    if(listEl) listEl.innerHTML = mc.jobs.slice().sort((a,b)=>(intervalHours(a.interval)||0)-(intervalHours(b.interval)||0)).map(rhJobLine).join('');
    bindDoneButtons(mc);
  }
  function bindDoneButtons(mc){
    const listEl = view.querySelector('.rh-jobs[data-rh-joblist="'+CSS.escape(mc.key)+'"]');
    if(!listEl) return;
    listEl.querySelectorAll('[data-rh-done]').forEach(btn=> btn.addEventListener('click', ()=>{
      const id = Number(btn.dataset.rhDone);
      completeJob(id, {location:'At Sea', doneDate:TODAY});
      toast('Marked complete — hours reset');
      renderRunningHours();
    }));
  }
  machines.forEach(bindDoneButtons);
  view.querySelectorAll('.rh-input').forEach(input=>{
    const key = input.dataset.mkey;
    const preview = view.querySelector('.rh-preview[data-rh-preview="'+CSS.escape(key)+'"]');
    // live preview as the user types (input = NEW hours to add)
    input.addEventListener('input', ()=>{
      const mc = byKey.get(key); if(!mc) return;
      const listEl = view.querySelector('.rh-jobs[data-rh-joblist="'+CSS.escape(key)+'"]');
      if(input.value===''){ if(preview) preview.style.display='none'; renderSavedJobs(mc); return; }
      const add = Number(input.value);
      if(isNaN(add) || add<0){ if(preview){ preview.style.display='block'; preview.style.color='var(--red)'; preview.textContent='Enter a valid number'; } return; }
      let newlyDue=0;
      if(listEl){
        listEl.innerHTML = mc.jobs.slice().sort((a,b)=>(intervalHours(a.interval)||0)-(intervalHours(b.interval)||0)).map(j=>{
          const iv=intervalHours(j.interval)||0; const acc=jobAccumHoursPreview(j, add);
          const wasDue=!!STATE.hoursDueDate[j.id]; const nowDue=acc>=iv && iv>0;
          if(nowDue && !wasDue) newlyDue++;
          const pct = iv? Math.min(100, Math.round(acc/iv*100)) : 0;
          const stateCls = nowDue? 'rh-due' : (pct>=80?'rh-soon':'');
          return '<div class="rh-job '+stateCls+'">'+
              '<div class="rh-job-main">'+
                '<div class="rh-job-name">'+esc(j.item)+'</div>'+
                '<div class="rh-job-meter"><div class="rh-meter-track"><div class="rh-meter-fill" style="width:'+pct+'%"></div></div>'+
                  '<span class="rh-job-num">'+acc.toLocaleString()+' / '+iv.toLocaleString()+' h</span></div>'+
                (nowDue? '<span class="rh-badge">'+(wasDue?'DUE '+shortDateNoYear(STATE.hoursDueDate[j.id]):'BECOMES DUE')+'</span>' : '<span class="rh-remain">'+Math.max(0,iv-acc).toLocaleString()+' h left</span>')+
              '</div>'+
            '</div>';
        }).join('');
      }
      if(preview){
        const newTotal = machineAdded(key)+add;
        preview.style.display='block'; preview.style.color='var(--interval-hours)';
        preview.innerHTML = 'After adding <b>'+add.toLocaleString()+' h</b> → total <b>'+newTotal.toLocaleString()+' h</b>'+(newlyDue>0? ' · <span style="color:var(--amber)">'+newlyDue+' job'+(newlyDue===1?'':'s')+' will become due</span>':'')+' — tap Add to apply';
      }
    });
  });
  view.querySelectorAll('.rh-save').forEach(btn=> btn.addEventListener('click', ()=>{
    const key=btn.dataset.mkey;
    const input=view.querySelector('.rh-input[data-mkey="'+CSS.escape(key)+'"]');
    if(!input || input.value===''){ toast('Enter hours to add'); return; }
    const add = Number(input.value);
    if(isNaN(add) || add<=0){ toast('Enter a valid number'); return; }
    const prevDue = Object.keys(STATE.hoursDueDate).length;
    if(addMachineHours(key, add)){
      const newly = Object.keys(STATE.hoursDueDate).length - prevDue;
      toast(newly>0? newly+' job'+(newly===1?'':'s')+' now due' : 'Added '+add.toLocaleString()+' h');
      renderRunningHours();
    } else { toast('Invalid hours'); }
  }));
  view.querySelectorAll('.rh-input').forEach(inp=> inp.addEventListener('keydown', e=>{
    if(e.key==='Enter'){ const b=view.querySelector('.rh-save[data-mkey="'+CSS.escape(inp.dataset.mkey)+'"]'); if(b) b.click(); }
  }));
}

/* ============================================================
   VIEW: UNIVERSAL SEARCH
   ============================================================ */
function renderSearch(){
  const q = nav.searchQuery||'';
  document.getElementById('view-search').innerHTML =
    '<div class="section-title">🔍 Search</div>'+
    '<input type="text" class="search-box" id="uniSearch" placeholder="Search item, machine, work… or a date like &quot;Jul&quot;, &quot;17 Jul&quot;, 2026-07-17" value="'+esc(q)+'">'+
    '<div id="searchResults"></div>';
  const input = document.getElementById('uniSearch');
  input.addEventListener('input', ()=>{ nav.searchQuery=input.value; runSearch(input.value); });
  input.focus();
  runSearch(q);
}
/* ---------- Date-aware query parsing ----------
   The old parser searched the query for a month name ANYWHERE inside a word, so
   "deck" hit "december" (dec…) and every December job came back. That is wrong.

   Rules now:
   • A month is only recognised from a WHOLE token that is EXACTLY the 3-letter
     abbreviation (jul, dec, …) or the full month name (july, december).
     "deck", "decking", "julia" are ordinary text — never a month.
   • A date query is only a date query if the WHOLE query is nothing but date
     parts (month token / day number / year / ISO / d-m-y). Anything else — even
     "jul pump" — falls through to text search, where the month token still
     matches the due date.                                                     */
const MON_ABBR = MON.map(m=>m.slice(0,3).toLowerCase());
const MON_FULL = MON.map(m=>m.toLowerCase());
/* month index (1-12) for an exact token, else 0 */
function monthFromToken(tok){
  tok = String(tok||'').toLowerCase();
  let i = MON_ABBR.indexOf(tok);            // exactly "jul"
  if(i>=0) return i+1;
  i = MON_FULL.indexOf(tok);                // exactly "july"
  if(i>=0) return i+1;
  return 0;
}
function parseDateQuery(q){
  q = String(q||'').toLowerCase().trim();
  if(!q) return null;

  // ISO or partial ISO: 2026-08-06 / 2026-08 / 2026
  let m = q.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if(m) return { year:+m[1], mon:m[2]?+m[2]:null, day:m[3]?+m[3]:null };

  // numeric d-m or d/m (day first): 6-8, 6/8/26
  m = q.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if(m){ let y=m[3]?+m[3]:null; if(y&&y<100) y+=2000; return { day:+m[1], mon:+m[2], year:y }; }

  // Token form: every token must be a month name, a day number, or a year.
  // "jul", "jul 2026", "6 aug", "august 6 2026", "17 jul 26" → date.
  // "jul pump", "deck" → not a date (falls through to text search).
  const toks = q.split(/[\s,]+/).filter(Boolean);
  if(!toks.length || toks.length>3) return null;
  let mon=null, day=null, year=null;
  for(const t of toks){
    const mi = monthFromToken(t);
    if(mi){ if(mon!=null) return null; mon=mi; continue; }
    if(/^\d{4}$/.test(t)){ if(year!=null) return null; year=+t; continue; }
    if(/^\d{1,2}$/.test(t)){ if(day!=null) return null; day=+t; continue; }
    if(/^\d{2}$/.test(t)){ if(year!=null) return null; year=2000+ +t; continue; }
    return null;                       // a non-date token → this is a text search
  }
  // A bare day number ("17") on its own is too vague to be a date query.
  if(mon==null && year==null) return null;
  return { year, mon, day };
}
function runSearch(q){
  const box = document.getElementById('searchResults');
  const raw = String(q||'').trim();
  if(!raw){ box.innerHTML = '<div class="empty-state"><div class="big-icon">🔍</div><div class="msg">Type to search</div><div class="sub">Item, machine, system, work — words can be in any order. Or a due date like "6 Aug".</div></div>'; return; }

  // If the whole query parses as a date → precise date filter over ALL occurrences
  const wholeDate = parseDateQuery(raw);
  let cards;
  if(wholeDate){
    const occs=[];
    visibleJobs().forEach(job=>{
      occurrencesOf(job).forEach(o=>{ const d=parseISO(o.date);
        if(wholeDate.year!=null && d.getFullYear()!==wholeDate.year) return;
        if(wholeDate.mon!=null && (d.getMonth()+1)!==wholeDate.mon) return;
        if(wholeDate.day!=null && d.getDate()!==wholeDate.day) return;
        occs.push({job, date:o.date, status:o.status});
      });
    });
    occs.sort((a,b)=> a.date.localeCompare(b.date) || jobSortKey(a.job,b.job));
    cards = occs.map(o=>({html:jobCard(o.job,{occDate:o.date, occStatus:o.status})}));
    if(!occs.length){ box.innerHTML='<div class="empty-state"><div class="big-icon">🚫</div><div class="msg">No jobs on that date</div></div>'; return; }
    box.innerHTML='<div class="section-title" style="font-size:14px;">'+occs.length+' on '+esc(raw)+' · date match</div><div class="job-list" id="searchJobList">'+cards.map(c=>c.html).join('')+'</div>';
    attachJobActions(document.getElementById('searchJobList'));
    return;
  }
  // ---- multi-word text search over live occurrences ----
  // Words may appear in any order and match anywhere in the job's text. The due
  // date is searched separately and only on WHOLE tokens, so a text word like
  // "deck" can never match the month "December" through the date field.
  const words = raw.toLowerCase().split(/\s+/).filter(Boolean);
  let results = visibleJobs().filter(j=>{
    const due = getJobDue(j);
    const text = (j.item+' '+j.machine+' '+j.system+' '+j.group_full+' '+j.work+' '+j.dept+' '+intervalLabel(j.interval)).toLowerCase();
    const dateToks = (due ? (due+' '+shortDate(due)+' '+shortDateNoYear(due)) : '')
                       .toLowerCase().split(/[\s\-]+/).filter(Boolean);
    return words.every(w=> text.includes(w) || dateToks.includes(w));
  });
  results = sortJobs(results);
  if(!results.length){ box.innerHTML = '<div class="empty-state"><div class="big-icon">🚫</div><div class="msg">No matches for "'+esc(raw)+'"</div></div>'; return; }
  box.innerHTML = '<div class="section-title" style="font-size:14px;">'+results.length+' result'+(results.length===1?'':'s')+'</div><div class="job-list" id="searchJobList">'+results.map(j=>jobCard(j)).join('')+'</div>';
  attachJobActions(document.getElementById('searchJobList'));
}

/* ============================================================
   VIEW: SETTINGS
   ============================================================ */
/* ---------- Reset-to-sample-data: password gate ---------- */
const RESET_PASSWORD = '000';

function openResetGate(){
  const root=document.getElementById('popoverRoot');
  root.innerHTML =
    '<div class="sheet-overlay" id="rgOverlay"></div>'+
    '<div class="complete-sheet" id="rgSheet" style="max-width:400px;">'+
      '<div class="cs-grip"></div>'+
      '<div class="cs-title">🔒 Password required</div>'+
      '<div class="batch-note" style="margin-bottom:12px;">Resetting wipes the imported job list and restores the built-in sample data. Enter the password to continue.</div>'+
      '<input class="gate-input" id="rgPass" type="password" inputmode="numeric" maxlength="12" autocomplete="off" placeholder="•••">'+
      '<div class="gate-err" id="rgErr"></div>'+
      '<div class="cs-actions"><button class="btn" id="rgCancel">Cancel</button><button class="btn primary" id="rgOk">Unlock</button></div>'+
    '</div>';
  const close=()=>{ root.innerHTML=''; };
  document.getElementById('rgOverlay').addEventListener('click', close);
  document.getElementById('rgCancel').addEventListener('click', close);
  setTimeout(()=>{ const i=document.getElementById('rgPass'); if(i) i.focus(); }, 60);

  const submit=()=>{
    const val=(document.getElementById('rgPass').value||'').trim();
    if(val !== RESET_PASSWORD){
      // wrong password → say so and drop straight back to the Settings screen
      close(); toast('Incorrect password');
      switchTab('settings');
      return;
    }
    close();
    confirmResetNow();
  };
  document.getElementById('rgOk').addEventListener('click', submit);
  document.getElementById('rgPass').addEventListener('keydown', e=>{ if(e.key==='Enter') submit(); });
}
function confirmResetNow(){
  openConfirmSheet({
    title:'Reset to sample data?',
    body:'Your imported jobs will be removed and the built-in sample list restored.',
    okLabel:'Yes, reset',
    cancelLabel:'No',
    onOk:()=>{
      RAW=JSON.parse(document.getElementById('pms-data').textContent);
      IMPORT_META={vessel:null,company:null,reportDate:null};
      try{ localStorage.removeItem(IMPORTED_JOBS_KEY); localStorage.removeItem(META_KEY); }catch(err){}
      refreshHeader(); recomputeHoursDue(); toast('Reset to sample data');
      renderNav(); renderCurrentView();
    }
  });
}

function renderSettings(){
  const doneCount=Object.values(STATE.statuses).filter(s=>s==='done').length;
  const postponedCount=Object.values(STATE.statuses).filter(s=>s==='postponed').length;
  const sinceStr = IMPORT_META.reportDate ? shortDate(IMPORT_META.reportDate) : '10 Jul 2026';
  document.getElementById('view-settings').innerHTML =
    '<div class="section-title">⚙ Settings</div>'+
    '<div class="panel settings-block"><h4>Import Jobs — CSV or JSON</h4>'+
      '<p>Currently loaded: <b>'+RAW.length+'</b> job'+(RAW.length===1?'':'s')+'. Import your PMS export directly as <b>PMS_DATA.csv</b> (raw software export) — converted automatically — or a filtered <b>.txt/.json</b> job list.</p>'+
      '<button class="btn primary" id="importJobsBtn">⬆ Import PMS_DATA.csv / JSON</button><button class="btn danger" id="resetJobsBtn">Reset to sample data</button>'+
      '<input type="file" id="importJobsFile" accept=".csv,.txt,.json,application/json,text/csv"></div>'+
    '<div class="panel settings-block"><h4>Estimated Sign-Off</h4>'+
      '<p>Jobs due after this date are hidden everywhere, so you only see what\'s relevant to your time on board.</p>'+
      '<div class="cp-date-row" style="max-width:260px;"><input type="date" id="signOffInput" value="'+(STATE.signOffDate||'')+'"></div>'+
      '<div style="margin-top:10px;"><button class="btn primary" id="signOffSaveBtn">Save sign-off date</button>'+(STATE.signOffDate?'<button class="btn" id="signOffClearBtn">Clear</button>':'')+'</div>'+
      (STATE.signOffDate?'<p style="margin-top:10px;margin-bottom:0;">Hiding jobs due after <b>'+shortDate(STATE.signOffDate)+'</b>.</p>':'')+'</div>'+
    '<div class="panel settings-block"><h4>Feedback &amp; Sound</h4>'+
      '<p>Play a soft tap sound and vibrate when you switch between the bottom navigation tabs.</p>'+
      '<div class="toggle-row"><span class="tr-text">Tap sound</span><div class="switch'+(STATE.soundOn?' on':'')+'" id="soundToggle" role="switch" aria-checked="'+(STATE.soundOn?'true':'false')+'"></div></div>'+
      '<div class="toggle-row"><span class="tr-text">Vibration (haptics)</span><div class="switch'+(STATE.vibrateOn?' on':'')+'" id="vibrateToggle" role="switch" aria-checked="'+(STATE.vibrateOn?'true':'false')+'"></div></div>'+
    '</div>'+
    '<div class="panel settings-block"><h4>Appearance</h4><p>Switch between dark and light mode. Remembered on this device. Tip: double-tap Spacebar to toggle.</p><button class="btn" id="settingsThemeToggle">Toggle theme</button></div>'+
    '<div class="panel settings-block"><h4>Sync between PC and Mobile</h4><p><b>'+doneCount+'</b> done · <b>'+postponedCount+'</b> postponed · <b>'+activePermits().length+'</b> open permits. Export your progress + permits to carry between devices.</p><button class="btn primary" id="exportBtn">⬇ Export progress (JSON)</button><button class="btn" id="importBtn">⬆ Import progress</button><input type="file" id="importFile" accept="application/json,.json"></div>'+
    '<div class="panel settings-block"><h4>Export as CSV</h4><p>Export the full job list with current status.</p><button class="btn" id="exportCsvBtn">⬇ Export CSV</button></div>'+
    '<div class="panel settings-block"><h4>About</h4><p style="font-family:var(--font-mono);font-size:11.5px;">Vessel: '+esc(IMPORT_META.vessel||'M.V. Seaways Mirage')+'<br>Company: '+esc(IMPORT_META.company||'Anglo-Eastern Tanker Management')+'<br>Total PMS items: '+RAW.length+'<br><b>This data starts from '+sinceStr+'</b> (PMS export date)<br>App version: <span class="version-pill">v'+APP_VERSION+'</span><br><br>This app is developed by ETO.</p></div>';

  document.getElementById('settingsThemeToggle').addEventListener('click', toggleTheme);
  // sound / vibration toggles
  const sw=document.getElementById('soundToggle');
  if(sw) sw.addEventListener('click', ()=>{ STATE.soundOn=!STATE.soundOn; saveState(); sw.classList.toggle('on',STATE.soundOn); sw.setAttribute('aria-checked',STATE.soundOn?'true':'false'); if(STATE.soundOn) playTapSound(); });
  const vw=document.getElementById('vibrateToggle');
  if(vw) vw.addEventListener('click', ()=>{ STATE.vibrateOn=!STATE.vibrateOn; saveState(); vw.classList.toggle('on',STATE.vibrateOn); vw.setAttribute('aria-checked',STATE.vibrateOn?'true':'false'); if(STATE.vibrateOn) hapticTap(); });
  document.getElementById('importJobsBtn').addEventListener('click', ()=> document.getElementById('importJobsFile').click());
  document.getElementById('importJobsFile').addEventListener('change', e=>{
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const res = importAnyFormat(reader.result);
        if(!res.jobs || !res.jobs.length){ toast('No jobs found in file'); return; }
        RAW = res.jobs;
        if(res.vessel||res.company||res.reportDate){ IMPORT_META={ vessel:res.vessel, company:res.company, reportDate:res.reportDate }; }
        try{ localStorage.setItem(IMPORTED_JOBS_KEY, JSON.stringify(RAW)); localStorage.setItem(META_KEY, JSON.stringify(IMPORT_META)); }catch(err){}
        refreshHeader();
        recomputeHoursDue();
        toast('Imported '+RAW.length+' jobs');
        renderNav(); renderCurrentView();
      }catch(err){ toast('Could not read file — expected PMS CSV or JSON'); }
    };
    reader.readAsText(file);
  });
  // Reset is destructive → password gate first, then an explicit yes/no confirm.
  document.getElementById('resetJobsBtn').addEventListener('click', openResetGate);
  document.getElementById('signOffSaveBtn').addEventListener('click', ()=>{ STATE.signOffDate=document.getElementById('signOffInput').value||null; saveState(); toast(STATE.signOffDate?'Sign-off date saved':'Sign-off cleared'); renderSettings(); });
  const cbtn=document.getElementById('signOffClearBtn'); if(cbtn) cbtn.addEventListener('click', ()=>{ STATE.signOffDate=null; saveState(); toast('Sign-off cleared'); renderSettings(); });
  document.getElementById('exportBtn').addEventListener('click', ()=>{ downloadBlob(new Blob([JSON.stringify(STATE,null,2)],{type:'application/json'}),'pms_progress_'+TODAY+'.json'); toast('Progress exported'); });
  document.getElementById('importBtn').addEventListener('click', ()=> document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', e=>{
    const file=e.target.files[0]; if(!file) return; const reader=new FileReader();
    reader.onload=()=>{ try{ const imp=JSON.parse(reader.result); if(imp&&typeof imp==='object'){
      if(imp.statuses) STATE.statuses=imp.statuses; if(imp.jobMeta) STATE.jobMeta=imp.jobMeta; if(imp.jobDueOverride) STATE.jobDueOverride=imp.jobDueOverride; if(imp.permits) STATE.permits=imp.permits; if('signOffDate' in imp) STATE.signOffDate=imp.signOffDate; if(imp.theme) STATE.theme=imp.theme;
      if(imp.machineHoursAdded) STATE.machineHoursAdded=imp.machineHoursAdded;
      else if(imp.machineHours && imp.machineHoursBase){ // migrate old absolute-counter exports → added-hours model
        const added={}; Object.keys(imp.machineHours).forEach(k=>{ const d=Number(imp.machineHours[k])-Number(imp.machineHoursBase[k]); if(!isNaN(d)&&d>0) added[k]=d; }); STATE.machineHoursAdded=added;
      }
      if(imp.hoursJobBase) STATE.hoursJobBase=imp.hoursJobBase; if(imp.hoursDueDate) STATE.hoursDueDate=imp.hoursDueDate;
      if(Array.isArray(imp.importantDates)) STATE.importantDates=imp.importantDates; if('soundOn' in imp) STATE.soundOn=imp.soundOn; if('vibrateOn' in imp) STATE.vibrateOn=imp.vibrateOn;
      if(imp.postponedUntil) STATE.postponedUntil=imp.postponedUntil;
      recomputeHoursDue(); saveState(); toast('Progress imported'); renderNav(); renderCurrentView(); } else toast('Invalid file'); }catch(err){ toast('Could not read file'); } };
    reader.readAsText(file);
  });
  document.getElementById('exportCsvBtn').addEventListener('click', ()=>{
    const header=['System','Machine','PMS Item','Work','Done','Due','Interval','Critical','Status'];
    const lines=[header.join(',')];
    RAW.forEach(j=>{ const status=getStatus(j)||'pending'; const row=[j.system,j.machine,j.item,j.work,j.done||'',getJobDue(j),j.interval,j.critical?'Y':'',status].map(v=>'"'+String(v).replace(/"/g,'""')+'"'); lines.push(row.join(',')); });
    downloadBlob(new Blob([lines.join('\n')],{type:'text/csv'}),'pms_status_'+TODAY+'.csv'); toast('CSV exported');
  });
}
function downloadBlob(blob,filename){ const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); }

/* ============================================================
   THEME
   ============================================================ */
function applyTheme(theme){
  if(theme==='light') document.body.setAttribute('data-theme','light'); else document.body.removeAttribute('data-theme');
  document.getElementById('themeToggle').textContent = theme==='light' ? '🌙' : '☀️';
  const meta=document.querySelector('meta[name=theme-color]'); if(meta) meta.setAttribute('content', theme==='light'?'#f0f2f5':'#09111f');
}
function toggleTheme(){ const cur=document.body.getAttribute('data-theme')==='light'?'light':'dark'; const next=cur==='light'?'dark':'light'; STATE.theme=next; saveState(); applyTheme(next); }
function initTheme(){ applyTheme(STATE.theme||'dark'); }

/* ============================================================
   TOAST
   ============================================================ */
let toastTimer=null;
function toast(msg){ const el=document.getElementById('toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),1800); }

/* ============================================================
   FEEDBACK — soft tap sound (WebAudio, no assets) + haptic vibration
   Both are user-toggleable in Settings; default ON. Audio must be created
   after a user gesture (nav taps qualify), so we lazily build the context.
   ============================================================ */
let _audioCtx=null;
function playTapSound(){
  if(!STATE.soundOn) return;
  try{
    const AC = window.AudioContext||window.webkitAudioContext; if(!AC) return;
    if(!_audioCtx) _audioCtx = new AC();
    if(_audioCtx.state==='suspended') _audioCtx.resume();
    const t=_audioCtx.currentTime;
    const osc=_audioCtx.createOscillator(); const gain=_audioCtx.createGain();
    osc.type='sine'; osc.frequency.setValueAtTime(660, t); osc.frequency.exponentialRampToValueAtTime(440, t+0.05);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t+0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t+0.13);
    osc.connect(gain); gain.connect(_audioCtx.destination);
    osc.start(t); osc.stop(t+0.14);
  }catch(e){}
}
function hapticTap(){ if(!STATE.vibrateOn) return; try{ if(navigator.vibrate) navigator.vibrate(12); }catch(e){} }
function navFeedback(){ playTapSound(); hapticTap(); }

/* ============================================================
   HEADER
   ============================================================ */
function refreshHeader(){
  document.getElementById('vesselName').textContent = (IMPORT_META.vessel||'M.V. SEAWAYS MIRAGE').toUpperCase();
  document.getElementById('companyName').textContent = IMPORT_META.company||'Anglo-Eastern Tanker Management';
  const since = IMPORT_META.reportDate ? shortDate(IMPORT_META.reportDate) : '10 Jul 2026';
  document.getElementById('sinceLine').textContent = 'Since '+since+' · '+RAW.length+' items';
}

/* ============================================================
   KEYBOARD  (desktop) + is-desktop detection
   ============================================================ */
function detectDesktop(){
  const isTouch = matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints>0;
  const wide = window.innerWidth>900;
  document.body.classList.toggle('is-desktop', !isTouch && wide);
}
let lastSpaceTime=0, lastSTime=0;
document.addEventListener('keydown', e=>{
  const tag=(document.activeElement&&document.activeElement.tagName||'').toLowerCase();
  if(tag==='input'||tag==='select'||tag==='textarea') return;
  if(nav.tab==='daily' && (e.key==='ArrowLeft'||e.key==='ArrowRight')){ e.preventDefault(); navDay(e.key==='ArrowLeft'?-1:1); return; }
  if(e.code==='Space'||e.key===' '){ const now=Date.now(); if(now-lastSpaceTime<2000){ e.preventDefault(); toggleTheme(); lastSpaceTime=0; } else lastSpaceTime=now; return; }
  // double-S → open search
  if(e.key==='s'||e.key==='S'){ const now=Date.now(); if(now-lastSTime<2000){ e.preventDefault(); switchTab('search'); lastSTime=0; } else lastSTime=now; }
});

/* ============================================================
   HARDWARE / BROWSER BACK BUTTON
   ============================================================ */
window.addEventListener('popstate', ()=>{
  const modal=document.getElementById('modalRoot');
  const pop=document.getElementById('popoverRoot');
  // 1) a transient popover (complete dialog) closes first, consumes the back
  if(pop.innerHTML){ pop.innerHTML=''; history.pushState({depth:HISTORY.length}, ''); return; }
  // 2) a standalone modal not tracked by nav (permit / counter list) closes, consumes the back
  if(modal.innerHTML && !nav.__dayModal){ modal.innerHTML=''; history.pushState({depth:HISTORY.length}, ''); return; }
  // 3) walk our logical history
  if(HISTORY.length>0){
    const prev=HISTORY.pop();
    modal.innerHTML='';          // clear any day-modal; render() re-shows if the target still wants it
    applySnapshot(prev);
    render();
    history.pushState({depth:HISTORY.length}, '');   // keep a live entry so the next back fires
  } else if(nav.tab!=='home'){
    // no history but not on home → land on home, still capture next back
    modal.innerHTML='';
    Object.assign(nav,{tab:'home', system:null, machine:null, monthBucket:null, __dayModal:null});
    render();
    history.pushState({depth:0}, '');
  } else {
    // on home with empty history → ask before exiting (keep a live entry so we stay put)
    history.pushState({depth:0}, '');
    showExitPopup();
  }
});
/* bottom exit confirmation */
function showExitPopup(){
  if(document.getElementById('exitOverlay')) return;
  const root=document.getElementById('popoverRoot');
  root.innerHTML =
    '<div class="sheet-overlay" id="exitOverlay"></div>'+
    '<div class="exit-sheet">'+
      '<div class="exit-title">Exit PMS Dashboard?</div>'+
      '<div class="exit-actions"><button class="btn" id="exitCancel">Cancel</button><button class="btn danger" id="exitOk">Exit</button></div>'+
    '</div>';
  document.getElementById('exitOverlay').addEventListener('click', ()=>{ root.innerHTML=''; });
  document.getElementById('exitCancel').addEventListener('click', ()=>{ root.innerHTML=''; });
  document.getElementById('exitOk').addEventListener('click', ()=>{
    root.innerHTML='';
    // best-effort close; browsers may block window.close() for non-script-opened tabs
    try{ window.close(); }catch(e){}
    // as a fallback, go back far enough to leave the app
    history.go(-(HISTORY.length+2));
  });
}

/* ============================================================
   INIT
   ============================================================ */
function init(){
  detectDesktop();
  window.addEventListener('resize', ()=>{ detectDesktop(); moveNavSlider(); });
  initTheme();
  reflashPostponedPermits();
  recomputeHoursDue();
  refreshHeader();
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('permitBell').addEventListener('click', openPermitModal);

  // chip zone: toggle open/closed; auto-collapse when tapping elsewhere or scrolling content
  const topSearch = document.getElementById('topSearch');
  if(topSearch) topSearch.addEventListener('click', ()=> switchTab('search'));
  document.getElementById('content').addEventListener('click', ()=>{ unflipCurrent(); }, true);
  window.addEventListener('scroll', ()=>{ unflipCurrent(); }, {passive:true});
  document.getElementById('content').addEventListener('touchmove', ()=>{ unflipCurrent(); }, {passive:true});

  // restore the screen the user was on before a refresh (before the first render)
  restoreNav();

  renderNav();
  render();
  updatePermitBell();
  // seed one browser-history entry so the first hardware back is captured
  history.replaceState({depth:0}, '');
  history.pushState({depth:0}, '');
  if(activePermits().length){ setTimeout(()=>toast('📋 '+activePermits().length+' PTW-06 permit(s) pending'), 700); }

  // Register service worker for offline / installable PWA (only over http/https)
  if('serviceWorker' in navigator && location.protocol.startsWith('http')){
    window.addEventListener('load', ()=>{ navigator.serviceWorker.register('service-worker.js').catch(()=>{}); });
  }
}

init();

})();
