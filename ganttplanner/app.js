// Buffer key for the JSON text area content
const JSON_BUFFER_KEY = 'ganttJSONBuffer';

// Save JSON text to memory
function saveJsonBuffer(text) {
  try { localStorage.setItem(JSON_BUFFER_KEY, text ?? ''); } catch {}
}

// Load JSON text from memory
function loadJsonBuffer() {
  try { return localStorage.getItem(JSON_BUFFER_KEY) || ''; } catch { return ''; }
}

function isValidISODate(s){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t=new Date(s).getTime();
  return Number.isFinite(t);
}

/* ===================== Data + storage ===================== */
let tasks = [];
function save(){ localStorage.setItem("ganttMemory", JSON.stringify(tasks)); }
function load(){ const data=localStorage.getItem("ganttMemory"); if(data) tasks=JSON.parse(data); }
load();

/* ADD TASK */
function addTask(){
    const name = nameInput.value.trim();
    const date = dateInput.value;
    const days = parseInt(daysInput.value);
    if(!name || !date || !days){ alert("Please fill in all fields."); return; }
    tasks.push({name,date,days});
    save(); render();
}

/* UPDATE single field */
function updateTask(i, key, val){
  if (key === 'date') {
    if (!isValidISODate(val)) {
      const el = document.querySelectorAll('.left-row .input-date')[i];
      if (el) { el.classList.add('invalid'); setTimeout(()=>el.classList.remove('invalid'), 1200); }
      return;
    }
  }
  if (key === 'days') {
    const n = parseInt(val);
    if (!Number.isFinite(n)) return;
    val = Math.max(1, n);
  }
  tasks[i][key] = val;
  save(); renderRight();
}

/* CLEAR ALL */
function clearAll(){
  if(confirm("Clear all tasks?")){
    tasks = [];
    save(); render();
  }
}

/* ===================== JSON ===================== */
async function exportJSON() {
  const text = JSON.stringify(tasks, null, 2);
  const ta = document.getElementById('jsonArea');
  if (ta) ta.value = text;
  try { await navigator.clipboard.writeText(text); }
  catch { window.prompt('Copy JSON manually:', text); }
  saveJsonBuffer(text);
}

function importJSON() {
  const ta = document.getElementById('jsonArea');
  const raw = (ta?.value ?? '').trim();
  saveJsonBuffer(raw);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("An array of tasks is expected.");
    tasks = parsed;
    save();
    render();
  } catch (e) {
    alert("Invalid JSON: " + e.message);
  }
}

/* ===================== Business day logic ===================== */
const MS_PER_DAY = 86400000;
function isWeekend(d){ const day=d.getDay(); return day===0 || day===6; }
function addBusinessDays(start, n){
    let d=new Date(start); d.setHours(0,0,0,0);
    while(isWeekend(d)) d=new Date(d.getTime()+MS_PER_DAY);
    let added=0; while(added<n){ d=new Date(d.getTime()+MS_PER_DAY); if(!isWeekend(d)) added++; }
    return d;
}
function businessEndDateInclusive(start, nDays){ if(nDays<=0) return new Date(start); return addBusinessDays(start, nDays-1); }
function businessDaysInclusiveCount(start, end){
    const s=new Date(start); s.setHours(0,0,0,0);
    const e=new Date(end);   e.setHours(0,0,0,0);
    if (s>e) return 0;
    let count=0;
    for (let d=new Date(s); d<=e; d=new Date(d.getTime()+MS_PER_DAY)) { if(!isWeekend(d)) count++; }
    return count;
}
const EN_MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];

/* ===================== URL <-> JSON encoding ===================== */
function u8ToBin(u8){ let s=''; for(let i=0;i<u8.length;i++) s+=String.fromCharCode(u8[i]); return s; }
function binToU8(bin){ const u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i)&0xFF; return u8; }
function encodeToURL(jsonObj){ const json=JSON.stringify(jsonObj); const deflated=window.pako?pako.deflate(json):new TextEncoder().encode(json); const base64=btoa(u8ToBin(deflated)); return base64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function decodeFromURL(str){ if(!str) throw new Error("Empty parameter"); str=str.replace(/-/g,'+').replace(/_/g,'/'); while(str.length%4) str+='='; const bin=atob(str); const data=binToU8(bin); const inflated=window.pako?pako.inflate(data,{to:'string'}):new TextDecoder().decode(data); return JSON.parse(inflated); }
function copyURL() {
    try {
        const encoded = encodeToURL(tasks);
        const base = location.origin + location.pathname;
        const url = base + "?d=" + encoded;
        navigator.clipboard.writeText(url).then(()=>{ alert("Link copied to clipboard!"); }, ()=>{ prompt("Copy this URL:", url); });
    } catch (e) { console.error(e); alert("Failed to generate URL: " + e.message); }
}
(function bootstrapFromURL(){
    try {
        const params = new URLSearchParams(window.location.search);
        const d = params.get('d');
        if (d) {
            const decoded = decodeFromURL(d);
            if (Array.isArray(decoded)) { tasks = decoded; save(); }
        }
    } catch (e) { console.warn("Failed to decode data from URL:", e); }
})();

/* ===================== View + stride measurement ===================== */
const BAR_END_INSET = 1; // px
const viewState = { min: null, totalDays: 240, stride: 20 };
function measureDayStride(tableEl){
    const firstRow = tableEl.querySelector('tr'); if(!firstRow) return null;
    const cells = firstRow.querySelectorAll('td, th'); if(cells.length<2) return null;
    const r0=cells[0].getBoundingClientRect(); const r1=cells[1].getBoundingClientRect();
    return r1.left - r0.left;
}
function toISODate(d){ const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; }

/* ===================== Render ===================== */
function render(){ renderLeft(); renderRight(); }

/* ===================== LEFT PANEL (handle-only drag & drop) ===================== */
function renderLeft(){
    const left=document.getElementById("ganttLeft");
    left.innerHTML="";

    tasks.forEach((t,i)=>{
        const row=document.createElement("div");
        row.className="left-row";
        row.dataset.index = i; // drop target index

        // Drag handle (only this is draggable)
        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.title = 'Drag to reorder';
        handle.draggable = true;
        handle.dataset.index = i;
        handle.innerHTML = `
          <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
            <circle cx="3" cy="3" r="1.2" fill="#888"></circle>
            <circle cx="7" cy="3" r="1.2" fill="#888"></circle>
            <circle cx="3" cy="8" r="1.2" fill="#888"></circle>
            <circle cx="7" cy="8" r="1.2" fill="#888"></circle>
            <circle cx="3" cy="13" r="1.2" fill="#888"></circle>
            <circle cx="7" cy="13" r="1.2" fill="#888"></circle>
          </svg>
        `;
        handle.addEventListener('dragstart', onHandleDragStart);
        handle.addEventListener('dragend', onHandleDragEnd);

        // Input fields
        const fields = document.createElement('div');
        fields.style.display = 'flex';
        fields.style.gap = '5px';
        fields.style.flex = '1 1 auto';
        fields.innerHTML = `
            <input class="input-name" value="${t.name ?? ''}" placeholder="Name"
                   onchange="updateTask(${i},'name',this.value)"
                   onmousedown="event.stopPropagation()">
            <input class="input-date" type="date" value="${t.date ?? ''}" title="Start date"
                   oninput="this.classList.toggle('invalid', !isValidISODate(this.value) && this.value !== '')"
                   onchange="updateTask(${i},'date',this.value)"
                   onmousedown="event.stopPropagation()">
            <input class="input-days" type="number" value="${t.days ?? ''}" min="1" placeholder="Days"
                   onchange="updateTask(${i},'days',parseInt(this.value))"
                   onmousedown="event.stopPropagation()">
        `;

        // Row is drop target
        row.addEventListener("dragover", onRowDragOver);
        row.addEventListener("dragleave", onRowDragLeave);
        row.addEventListener("drop", onRowDrop);

        row.appendChild(handle);
        row.appendChild(fields);
        left.appendChild(row);
    });
}

/* ===== Drag & Drop: Handle-only logic ===== */
let draggedRowIndex = null;

function onHandleDragStart(e) {
    try { e.dataTransfer.setData('text/plain', ''); } catch {}
    e.dataTransfer.effectAllowed = 'move';
    draggedRowIndex = parseInt(e.currentTarget.dataset.index, 10);
    const row = e.currentTarget.closest('.left-row');
    if (row) row.classList.add('dragging');
}
function onHandleDragEnd() {
    document.querySelectorAll(".left-row.dragging").forEach(r => r.classList.remove("dragging"));
}

function onRowDragOver(e) {
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch {}
    e.currentTarget.classList.add('drag-over');
}
function onRowDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}
function onRowDrop(e) {
    e.preventDefault();
    const targetRow = e.currentTarget;
    targetRow.classList.remove('drag-over');
    const targetIndex = parseInt(targetRow.dataset.index, 10);

    if (!Number.isInteger(draggedRowIndex) || targetIndex === draggedRowIndex) {
        draggedRowIndex = null; render(); return;
    }

    // Compute insertion index (insert BEFORE target row)
    let insertIndex = targetIndex;
    if (targetIndex > draggedRowIndex) insertIndex = targetIndex - 1;

    const [moved] = tasks.splice(draggedRowIndex, 1);
    tasks.splice(insertIndex, 0, moved);

    draggedRowIndex = null;
    save();
    render();
}

/* ===================== RIGHT PANEL RENDERING ===================== */
function renderRight(){
    const container=document.getElementById("ganttRight");
    const timeScale=document.getElementById("timeScale");
    container.innerHTML=""; timeScale.innerHTML="";
    if(tasks.length===0){ return; }

    const validDates = tasks.map(t=>t && t.date ? new Date(t.date) : null).filter(d=>d && Number.isFinite(d.getTime()));
    if(validDates.length===0){ return; }

    let min = new Date(Math.min(...validDates.map(d=>d.getTime()))); min.setHours(0,0,0,0);
    const totalDays=viewState.totalDays;

    // Time scale
    const scaleTable=document.createElement("table"); scaleTable.className="gantt-table";
    const trMonths=document.createElement("tr");
    let i=0;
    while(i<totalDays){
      const d=new Date(min); d.setDate(d.getDate()+i);
      const y=d.getFullYear(); const m=d.getMonth();
      let span=0;
      while(i+span<totalDays){
        const d2=new Date(min); d2.setDate(d2.getDate()+i+span);
        if(d2.getMonth()!==m || d2.getFullYear()!==y) break;
        span++;
      }
      if(span<1 || !Number.isFinite(span)) span=1;
      const thMonth=document.createElement("th");
      thMonth.className="ts-month"; thMonth.setAttribute("colspan", span);
      const monthName=EN_MONTHS[m] ?? (m+1);
      thMonth.textContent=`${y} ${monthName}`;
      trMonths.appendChild(thMonth); i+=span;
    }
    const trDays=document.createElement("tr");
    for(let j=0;j<totalDays;j++){
        let d=new Date(min); d.setDate(d.getDate()+j);
        const th=document.createElement("th"); th.className="ts-day"; th.textContent=d.getDate();
        if(isWeekend(d)) th.classList.add("weekend");
        trDays.appendChild(th);
    }
    scaleTable.appendChild(trMonths); scaleTable.appendChild(trDays); timeScale.appendChild(scaleTable);

    // Gantt rows
    const ganttTable=document.createElement("table"); ganttTable.className="gantt-table";
    tasks.forEach(()=>{
        const row=document.createElement("tr");
        for(let k=0;k<totalDays;k++){
            let d=new Date(min); d.setDate(d.getDate()+k);
            const td=document.createElement("td"); td.className="gantt-row-td";
            if(isWeekend(d)) td.classList.add("weekend");
            row.appendChild(td);
        }
        ganttTable.appendChild(row);
    });
    container.appendChild(ganttTable);

    const measured=measureDayStride(ganttTable);
    if(!measured || !isFinite(measured)){
        const v=getComputedStyle(document.documentElement).getPropertyValue('--dayW').trim();
        viewState.stride=parseFloat(v.replace('px','')) || 20;
    } else { viewState.stride=measured; }
    viewState.min=min;

    const rows=ganttTable.rows;
    tasks.forEach((t,idx)=>{
        const row=rows[idx];
        let start=new Date(t.date); start.setHours(0,0,0,0);
        const end=businessEndDateInclusive(start, parseInt(t.days||0));
        const startOffset=Math.round((start-min)/MS_PER_DAY);
        const endOffset=Math.round((end-min)/MS_PER_DAY);
        const clampedOffset=Math.max(0,startOffset);
        const clampedRight=Math.min(totalDays-1,endOffset);
        const visibleDays=Math.max(0,(clampedRight - clampedOffset + 1));
        if(visibleDays>0){
            const bar=document.createElement("div");
            bar.className="gantt-bar-abs";
            bar.style.left=(clampedOffset * viewState.stride)+"px";
            bar.style.width=Math.max(0,(visibleDays * viewState.stride) - 1)+"px";
            const hL=document.createElement('div'); hL.className='resize-handle-l';
            const hR=document.createElement('div'); hR.className='resize-handle-r';
            bar.appendChild(hL); bar.appendChild(hR);
            bar.dataset.index=String(idx);
            bar.dataset.startOffset=String(startOffset);
            bar.dataset.endOffset=String(endOffset);
            bar.dataset.visibleDays=String(visibleDays);
            bar.addEventListener('mousedown', onBarMouseDown);
            hL.addEventListener('mousedown', (e)=>onResizeMouseDown(e,'left'));
            hR.addEventListener('mousedown', (e)=>onResizeMouseDown(e,'right'));
            row.appendChild(bar);
        }
    });
}

/* ===================== Drag & Resize logic (bars) ===================== */
let dragState=null;
function onBarMouseDown(e){
    if (e.target.classList.contains('resize-handle-l') || e.target.classList.contains('resize-handle-r')) return;
    const bar=e.currentTarget;
    const idx=parseInt(bar.dataset.index,10);
    const startOffset=parseInt(bar.dataset.startOffset,10);
    const endOffset=parseInt(bar.dataset.endOffset,10);
    const visibleDays=parseInt(bar.dataset.visibleDays,10);
    dragState={ mode:'move', bar, idx, startX:e.clientX, startOffset, endOffset, currentOffset:startOffset, visibleDays, minOffset:0, maxOffset:Math.max(0, viewState.totalDays - visibleDays), scrollEl:document.getElementById('ganttScroll') };
    bar.classList.add('dragging'); document.body.classList.add('noselect');
    document.addEventListener('mousemove', onMouseMoveGeneric);
    document.addEventListener('mouseup', onMouseUpGeneric);
    e.preventDefault();
}
function onResizeMouseDown(e, side){
    const bar=e.currentTarget.parentElement;
    const idx=parseInt(bar.dataset.index,10);
    const startOffset=parseInt(bar.dataset.startOffset,10);
    const endOffset=parseInt(bar.dataset.endOffset,10);
    dragState={ mode: (side==='left')?'resize-left':'resize-right', bar, idx, startX:e.clientX, startOffset, endOffset, scrollEl:document.getElementById('ganttScroll'), minOffset:0, maxOffset:viewState.totalDays - 1 };
    bar.classList.add('dragging'); document.body.classList.add('noselect');
    document.addEventListener('mousemove', onMouseMoveGeneric);
    document.addEventListener('mouseup', onMouseUpGeneric);
    e.stopPropagation(); e.preventDefault();
}
function onMouseMoveGeneric(e){
    if(!dragState) return;
    const dx=e.clientX - dragState.startX;
    const deltaDays=Math.round(dx / viewState.stride);
    if(dragState.mode==='move'){
        let newStart=dragState.startOffset + deltaDays;
        const barSpan=dragState.endOffset - dragState.startOffset + 1;
        newStart=Math.max(0, Math.min(newStart, viewState.totalDays - barSpan));
        dragState.currentOffset=newStart;
        dragState.bar.style.left=(newStart * viewState.stride)+"px";
        autoScrollOnEdges(e, dragState.scrollEl); return;
    }
    if(dragState.mode==='resize-right'){
        let newEnd=dragState.endOffset + deltaDays;
        newEnd=Math.max(dragState.startOffset, Math.min(newEnd, dragState.maxOffset));
        const newVisibleDays=(Math.min(newEnd, viewState.totalDays - 1) - Math.max(0, dragState.startOffset) + 1);
        dragState.bar.style.width=Math.max(0, (newVisibleDays * viewState.stride) - 1)+"px";
        dragState.currentEnd=newEnd;
        autoScrollOnEdges(e, dragState.scrollEl); return;
    }
    if(dragState.mode==='resize-left'){
        let newStart=dragState.startOffset + deltaDays;
        newStart=Math.max(dragState.minOffset, Math.min(newStart, dragState.endOffset));
        const clampedLeft=Math.max(0, newStart);
        const clampedRight=Math.min(viewState.totalDays - 1, dragState.endOffset);
        const newVisibleDays=Math.max(0, clampedRight - clampedLeft + 1);
        dragState.bar.style.left=(clampedLeft * viewState.stride)+"px";
        dragState.bar.style.width=Math.max(0, (newVisibleDays * viewState.stride) - 1)+"px";
        dragState.currentStart=newStart;
        autoScrollOnEdges(e, dragState.scrollEl); return;
    }
}
function onMouseUpGeneric(){
    if(!dragState) return;
    const idx=dragState.idx; const t=tasks[idx];
    if(dragState.mode==='move'){
        const newStartOffset=dragState.currentOffset;
        const d=new Date(viewState.min); d.setDate(d.getDate()+newStartOffset);
        t.date = toISODate(d);
    }
    if(dragState.mode==='resize-right'){
        const newEndOffset=(typeof dragState.currentEnd==='number') ? dragState.currentEnd : dragState.endOffset;
        const startDate=new Date(t.date); startDate.setHours(0,0,0,0);
        const endDate=new Date(viewState.min); endDate.setDate(endDate.getDate()+newEndOffset);
        const bd=businessDaysInclusiveCount(startDate, endDate);
        t.days=Math.max(1, bd);
    }
    if(dragState.mode==='resize-left'){
        const newStartOffset=(typeof dragState.currentStart==='number') ? dragState.currentStart : dragState.startOffset;
        const fixedEnd=businessEndDateInclusive(new Date(t.date), parseInt(t.days||0));
        const newStartDate=new Date(viewState.min); newStartDate.setDate(newStartDate.getDate()+newStartOffset);
        if(newStartDate > fixedEnd){ newStartDate.setTime(fixedEnd.getTime()); }
        t.date = toISODate(newStartDate);
        const bd=businessDaysInclusiveCount(newStartDate, fixedEnd);
        t.days=Math.max(1, bd);
    }
    save(); renderLeft(); renderRight();
    dragState.bar.classList.remove('dragging'); document.body.classList.remove('noselect');
    document.removeEventListener('mousemove', onMouseMoveGeneric);
    document.removeEventListener('mouseup', onMouseUpGeneric);
    dragState=null;
}
function autoScrollOnEdges(e, scrollEl){
    const rect=scrollEl.getBoundingClientRect(); const edge=24; const step=12;
    if(e.clientX > rect.right - edge){ scrollEl.scrollLeft += step; }
    else if(e.clientX < rect.left + edge){ scrollEl.scrollLeft -= step; }
}

/* Initial render */
render();

/* Resizable Left Panel */
(function() {
    const left=document.getElementById("ganttLeft");
    const handle=document.getElementById("resizeHandle");
    let dragging=false;
    handle.addEventListener("mousedown", e=>{ dragging=true; document.body.style.cursor="col-resize"; e.preventDefault(); });
    document.addEventListener("mousemove", e=>{
        if(!dragging) return;
        let newWidth=e.clientX - left.getBoundingClientRect().left;
        newWidth=Math.max(150, Math.min(newWidth, 1000));
        left.style.width=newWidth + "px";
    });
    document.addEventListener("mouseup", ()=>{ dragging=false; document.body.style.cursor=""; });
})();

/* ===== JSON Modal wiring ===== */
(function() {
  const overlay = document.getElementById('jsonModalOverlay');
  const btnOpen = document.getElementById('btnJsonOpen');
  const btnClose = document.getElementById('btnClose');
  const btnExport = document.getElementById('btnExport');
  const btnImport = document.getElementById('btnImport');
  const jsonArea = document.getElementById('jsonArea');

  function openJsonModal() {
    const fromBuffer = loadJsonBuffer();
    if (fromBuffer) { jsonArea.value = fromBuffer; }
    else { try { jsonArea.value = JSON.stringify(tasks, null, 2); } catch { jsonArea.value = '[]'; } }

    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    setTimeout(() => jsonArea.focus(), 0);

    document.addEventListener('keydown', onEscClose);
  }

  function closeJsonModal() {
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', onEscClose);
  }

  function onEscClose(e){ if(e.key==='Escape') closeJsonModal(); }

  btnOpen.addEventListener('click', openJsonModal);
  btnClose.addEventListener('click', closeJsonModal);
  overlay.addEventListener('click', (e)=>{ if(e.target===overlay) closeJsonModal(); });

  btnExport.addEventListener('click', ()=>exportJSON());
  btnImport.addEventListener('click', ()=>{ importJSON(); /* keep modal open */ });

  document.getElementById('jsonArea')?.addEventListener('input', (e) => {
    saveJsonBuffer(e.target.value);
  });
})();