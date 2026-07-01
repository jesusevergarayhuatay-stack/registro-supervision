// === CONFIGURACIÓN Y GLOBALES ===
// _fbDb y fbRef definidos en firebase-config.js

let map;
let markers = {};
let currentSessionsRef = null;
let allSessionsOfDate = {};
const GOOGLE_WEBHOOK_URL = '';

// === SISTEMA DE ALARMAS ===
let alertedSessions = new Set(); // IDs ya notificados para no repetir
let alarmAudioCtx = null;
let alarmInterval = null;

function initAlarmSystem() {
    // Pedir permiso de notificaciones al cargar el dashboard
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    // Registrar SW para notificaciones en background
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
}

// Chequear si alguna sesión nueva tiene alertaActiva===true
function checkForNewAlerts(sessions) {
    Object.entries(sessions).forEach(([id, s]) => {
        if (s.alertaActiva === true && !alertedSessions.has(id)) {
            alertedSessions.add(id);
            triggerAlarm(s, id);
        }
        // Limpiar del Set si la alerta fue desactivada
        if (s.alertaActiva === false && alertedSessions.has(id)) {
            alertedSessions.delete(id);
        }
    });
}

function triggerAlarm(session, sessionId) {
    const msg = `🚨 ALERTA CRÍTICA\n${session.name} (${session.office})\n📍 ${session.location}`;

    // 1. Banner visual pulsante
    showAlertBanner(session);

    // 2. Sonido de alerta
    playAlarmSound();

    // 3. Notificación del browser
    showBrowserNotification(session);

    console.log('[ALARMA] Disparada para sesión:', sessionId, session.name);
}

function showAlertBanner(session) {
    let banner = document.getElementById('critical-alert-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'critical-alert-banner';
        banner.style.cssText = `
            position: fixed; top: 65px; left: 0; right: 0; z-index: 9000;
            background: linear-gradient(135deg, #c0392b, #e74c3c);
            color: white; padding: 14px 20px;
            display: flex; align-items: center; justify-content: space-between;
            box-shadow: 0 4px 20px rgba(231,76,60,0.6);
            animation: pulse-banner 1.5s infinite;
            border-bottom: 3px solid #922b21;
        `;
        document.head.insertAdjacentHTML('beforeend', `
            <style>
                @keyframes pulse-banner {
                    0%,100% { opacity:1; box-shadow: 0 4px 20px rgba(231,76,60,0.6); }
                    50% { opacity:0.88; box-shadow: 0 4px 30px rgba(231,76,60,0.9); }
                }
                @keyframes blink-icon { 0%,100%{transform:scale(1)} 50%{transform:scale(1.3)} }
                .alarm-icon { display:inline-block; animation: blink-icon 0.7s infinite; font-size:1.4rem; }
            </style>
        `);
        document.body.appendChild(banner);
    }

    banner.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px;">
            <span class="alarm-icon">🚨</span>
            <div>
                <div style="font-weight:800; font-size:1rem;">ALERTA CRÍTICA</div>
                <div style="font-size:0.85rem; opacity:0.9;">${session.name} — ${session.office} — 📍 ${session.location}</div>
            </div>
        </div>
        <button onclick="dismissAlertBanner()" style="background:rgba(255,255,255,0.2); border:none; color:white; padding:6px 14px; border-radius:8px; cursor:pointer; font-weight:700; font-size:0.85rem;">
            Reconocer ✓
        </button>
    `;
    banner.style.display = 'flex';

    // Auto-dismiss después de 60s si no hay interacción
    setTimeout(() => {
        if (banner.style.display !== 'none') dismissAlertBanner();
    }, 60000);
}

function dismissAlertBanner() {
    const banner = document.getElementById('critical-alert-banner');
    if (banner) banner.style.display = 'none';
    stopAlarmSound();
}

function playAlarmSound() {
    try {
        if (!alarmAudioCtx) alarmAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

        let count = 0;
        const beep = () => {
            if (count >= 6) return; // 3 doble-beeps
            const osc = alarmAudioCtx.createOscillator();
            const gain = alarmAudioCtx.createGain();
            osc.connect(gain);
            gain.connect(alarmAudioCtx.destination);
            osc.type = 'square';
            osc.frequency.value = count % 2 === 0 ? 880 : 660;
            gain.gain.setValueAtTime(0.3, alarmAudioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, alarmAudioCtx.currentTime + 0.25);
            osc.start(alarmAudioCtx.currentTime);
            osc.stop(alarmAudioCtx.currentTime + 0.25);
            count++;
            setTimeout(beep, 300);
        };
        beep();
    } catch (e) {
        console.warn('[Alarm] Error de audio:', e.message);
    }
}

function stopAlarmSound() {
    // El sonido es finito por diseño (6 beeps), no hay que detenerlo
}

function showBrowserNotification(session) {
    if (!('Notification' in window)) return;

    const show = () => {
        try {
            const n = new Notification('🚨 ALERTA CRÍTICA — Defensoría del Pueblo', {
                body: `${session.name} (${session.office})\n📍 ${session.location}`,
                icon: './icon-192.png',
                badge: './icon-192.png',
                tag: 'dp-alerta-critica',
                requireInteraction: true,
                vibrate: [200, 100, 200]
            });
            n.onclick = () => { window.focus(); n.close(); };
        } catch (e) {
            console.warn('[Notif] Error al mostrar notificación:', e.message);
        }
    };

    if (Notification.permission === 'granted') {
        show();
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(p => { if (p === 'granted') show(); });
    }
}

// Ícono de alerta definido globalmente para uso en updateMarker y syncOtherCommissioners
const alertaIcon = L.divIcon({
    html: "<div style='font-size:24px; background:red; border-radius:50%; padding:4px; border:3px solid white; box-shadow:0 0 12px red; display:flex; align-items:center; justify-content:center;'>🚨</div>",
    className: 'alerta-pin',
    iconSize: [38, 38],
    iconAnchor: [19, 19]
});

// --- INICIALIZACIÓN ---
// Exponer para onclick del banner
window.dismissAlertBanner = dismissAlertBanner;

function initDashboard() {
    initAlarmSystem();
    initMap();
    
    const filterDate = document.getElementById('filter-date');
    const filterProtest = document.getElementById('filter-protest');

    if (filterDate) filterDate.value = new Date().toISOString().split('T')[0];

    filterDate?.addEventListener('change', () => listenToSessions(filterDate.value));

    // Filtrado secundario por protesta
    filterProtest?.addEventListener('change', () => applyFilters());

    document.getElementById('refresh-btn')?.addEventListener('click', () => location.reload());
    
    // Botón Reporte PDF
    document.getElementById('btn-generar-pdf')?.addEventListener('click', () => {
        document.getElementById('pdf-obs-modal').classList.remove('hidden-modal');
        // Pre-rellenar coordinador si hay algo guardado
        const saved = localStorage.getItem('dp_coordinador');
        if (saved) document.getElementById('pdf-coordinador').value = saved;
    });
    document.getElementById('pdf-obs-cancel-btn')?.addEventListener('click', () => {
        document.getElementById('pdf-obs-modal').classList.add('hidden-modal');
    });
    document.getElementById('pdf-generar-btn')?.addEventListener('click', async () => {
        const obs = document.getElementById('pdf-observaciones')?.value || '';
        const coordinador = document.getElementById('pdf-coordinador')?.value || '';
        if (coordinador) localStorage.setItem('dp_coordinador', coordinador);
        document.getElementById('pdf-obs-modal').classList.add('hidden-modal');
        await generarReportePDF(obs, coordinador);
    });

    // Sync BI
    document.getElementById('sync-gsheets-btn')?.addEventListener('click', exportarAGoogleSheets);

    // Descargar CSV
    document.getElementById('btn-descargar-csv')?.addEventListener('click', descargarCSV);

    // Gestión de Catálogos
    document.getElementById('config-catalogos-btn')?.addEventListener('click', openCatalogosModal);
    document.getElementById('close-catalogos-btn')?.addEventListener('click', () => document.getElementById('catalogos-modal').classList.add('hidden-modal'));
    document.getElementById('add-protest-btn')?.addEventListener('click', addProtestToState);
    document.getElementById('add-point-btn')?.addEventListener('click', addPointToState);
    document.getElementById('save-catalogos-btn')?.addEventListener('click', saveCatalogosToFirebase);

    // Carga inicial
    listenToSessions(filterDate?.value || new Date().toISOString().split('T')[0]);
}

function initMap() {
    const mapEl = document.getElementById('map-dashboard');
    if (!mapEl) return;
    map = L.map('map-dashboard').setView([-12.0464, -77.0428], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
}

function listenToSessions(selectedDate) {
    if (!_fbDb) return;
    if (currentSessionsRef) currentSessionsRef.off();
    
    clearDashboard();
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = 'block';

    currentSessionsRef = fbRef('sessions').orderByChild('fecha').equalTo(selectedDate);
    
    currentSessionsRef.on('value', snap => {
        allSessionsOfDate = snap.val() || {};
        if (loadingEl) loadingEl.style.display = 'none';

        // Verificar nuevas alertas críticas
        checkForNewAlerts(allSessionsOfDate);

        populateProtestFilter(allSessionsOfDate);
        applyFilters();
    });
}

function populateProtestFilter(sessions) {
    const filter = document.getElementById('filter-protest');
    const currentVal = filter.value;
    const protests = new Set();
    
    Object.values(sessions).forEach(s => {
        if (s.protestName) protests.add(s.protestName);
    });

    // Mantener "Todas las protestas" y reconstruir
    filter.innerHTML = '<option value="all">Todas las protestas</option>';
    Array.from(protests).sort().forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        filter.appendChild(opt);
    });

    // Intentar restaurar selección previa si existe
    if (protests.has(currentVal)) filter.value = currentVal;
}

function applyFilters() {
    const selectedProtest = document.getElementById('filter-protest').value;
    
    let filtered = {};
    if (selectedProtest === 'all') {
        filtered = allSessionsOfDate;
    } else {
        Object.keys(allSessionsOfDate).forEach(id => {
            if (allSessionsOfDate[id].protestName === selectedProtest) {
                filtered[id] = allSessionsOfDate[id];
            }
        });
    }

    updateStatsAndMap(filtered);
    updateReportsList(filtered);
    updateGlobalFeed(filtered);
}

function clearDashboard() {
    Object.values(markers).forEach(m => map.removeLayer(m));
    markers = {};
    document.getElementById('reports-list').innerHTML = "";
    document.getElementById('global-feed').innerHTML = "";
    safeSetText('stat-active', '0');
    safeSetText('stat-incidents', '0');
    safeSetText('stat-heridos', '0');
    safeSetText('stat-fallecidos', '0');
    safeSetText('stat-detenidos', '0');
}

function updateStatsAndMap(sessions) {
    let active = 0;
    let totalIncidents = 0;
    let heridos = 0;
    let fallecidos = 0;
    let detenidos = 0;

    const activeIds = Object.keys(sessions);
    // Limpiar marcadores que ya no aplican al filtro
    Object.keys(markers).forEach(id => {
        if (!activeIds.includes(id)) {
            map.removeLayer(markers[id]);
            delete markers[id];
        }
    });

    activeIds.forEach(id => {
        const s = sessions[id];
        if (s.status !== 'finished') active++;

        const lat = s.currentLat || s.startLat;
        const lng = s.currentLng || s.startLng;

        if (lat && lng) updateMarker(id, s, lat, lng);

        if (s.incidents) {
            Object.values(s.incidents).forEach(inc => {
                totalIncidents++;
                if (inc.clasificacion === 'Heridos') heridos += parseInt(inc.cantidad || 1);
                if (inc.clasificacion === 'Fallecidos') fallecidos += parseInt(inc.cantidad || 1);
                if (inc.clasificacion === 'Privados de la libertad') detenidos += parseInt(inc.cantidad || 1);
            });
        }
    });

    safeSetText('stat-active', active);
    safeSetText('stat-incidents', totalIncidents);
    safeSetText('stat-heridos', heridos);
    safeSetText('stat-fallecidos', fallecidos);
    safeSetText('stat-detenidos', detenidos);
}

// Rastrear estado de alerta anterior por ID
const markerAlertState = {};

function updateMarker(id, s, lat, lng) {
    const hasAlert = s.alertaActiva === true;
    const normalIcon = new L.Icon.Default();
    const iconToUse = hasAlert ? alertaIcon : normalIcon;

    if (markers[id]) {
        markers[id].setLatLng([lat, lng]);
        // Forzar setIcon si el estado de alerta cambió
        if (markerAlertState[id] !== hasAlert) {
            markers[id].setIcon(iconToUse);
            markerAlertState[id] = hasAlert;
        }
    } else {
        markers[id] = L.marker([lat, lng], { icon: iconToUse }).addTo(map);
        markers[id].bindTooltip(s.name + ' (' + s.office + ')', {
            direction: 'top',
            className: 'waze-tooltip'
        });
        markerAlertState[id] = hasAlert;
    }
}

let latestFilteredSessions = {}; // Para el acordeón

function updateReportsList(sessions) {
    latestFilteredSessions = sessions;
    const list = document.getElementById('reports-list');
    if (!list) return;

    const sorted = Object.values(sessions).sort((a,b) => (b.startTime || 0) - (a.startTime || 0));
    
    list.innerHTML = sorted.map(s => {
        const isFinished = s.status === 'finished';
        const reportCount = s.incidents ? Object.keys(s.incidents).length : 0;
        const pName = s.protestName || 'Sin protesta asignada';
        
        return `<div class="supervision-card" onclick="toggleProtestStats(this, '${pName}')" style="background:#fff; padding:15px; border-radius:12px; margin-bottom:12px; border-left:5px solid ${isFinished ? '#95a5a6' : '#27ae60'}; box-shadow:0 4px 10px rgba(0,0,0,0.05);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                <div>
                    <span class="badge-status ${isFinished ? 'badge-finished' : 'badge-active'}">${isFinished ? 'Finalizado' : 'Activo'}</span>
                    <div style="font-weight:800; font-size:1.05rem; margin-top:5px; color:var(--primary);">${s.location || 'N/A'}</div>
                </div>
                <span style="font-size:0.75rem; color:#999; font-weight:600;">${formatTime(s.startTime)}</span>
            </div>
            <div style="font-size:0.9rem; color:#555; margin-bottom:10px;">
                <strong>${s.name}</strong> (${s.office})<br>
                <span style="color:var(--accent); font-size:0.8rem;">📍 ${pName}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #f0f0f0; padding-top:8px;">
                <span class="report-counter">🔔 ${reportCount} reportes</span>
                <span style="font-size:0.7rem; color:#aaa;">Marcha 🔽</span>
            </div>
            <div class="protest-stats-panel">
                <h4 style="font-size:0.8rem; margin-bottom:8px; color:var(--primary);">Resumen de esta Marcha:</h4>
                <div class="stats-row"><span>👥 Total Asignados:</span><span class="total-asignados">-</span></div>
                <div class="stats-row"><span style="color:var(--success);">🟢 Activos:</span><span class="activos-protesta">-</span></div>
                <div class="stats-row"><span style="color:#95a5a6;">🔴 Finalizados:</span><span class="finalizados-protesta">-</span></div>
            </div>
        </div>`;
    }).join('') || '<p style="text-align:center; padding:20px;">No hay reportes hoy.</p>';
}

function toggleProtestStats(card, protestName) {
    const panel = card.querySelector('.protest-stats-panel');
    const isExpanded = panel.classList.contains('expanded');
    document.querySelectorAll('.protest-stats-panel.expanded').forEach(p => { if (p !== panel) p.classList.remove('expanded'); });

    if (!isExpanded) {
        const group = Object.values(allSessionsOfDate).filter(s => (s.protestName || 'Sin protesta asignada') === protestName);
        panel.querySelector('.total-asignados').textContent = group.length;
        panel.querySelector('.activos-protesta').textContent = group.filter(s => s.status !== 'finished').length;
        panel.querySelector('.finalizados-protesta').textContent = group.filter(s => s.status === 'finished').length;
        panel.classList.add('expanded');
    } else {
        panel.classList.remove('expanded');
    }
}

function updateGlobalFeed(sessions) {
    const feed = document.getElementById('global-feed');
    if (!feed) return;

    let feedItems = [];
    Object.values(sessions).forEach(s => {
        if (s.incidents) {
            Object.values(s.incidents).forEach(inc => {
                feedItems.push({ ...inc, sessionLocation: s.location, protestRoom: s.protestName });
            });
        }
    });

    feedItems.sort((a,b) => b.timestamp - a.timestamp);
    feed.innerHTML = feedItems.map(inc => `
        <div class="chat-bubble chat-others" style="margin-bottom:12px; width:100%; max-width:100%; border-radius:8px;">
            <div class="chat-author">${inc.author} en ${inc.sessionLocation} (${inc.protestRoom || 'OD'})</div>
            <div style="font-weight:700; margin:5px 0; color:${getIncidentColor(inc.clasificacion)};">${inc.clasificacion}</div>
            <div>${inc.description}</div>
            ${inc.mediaUrls && inc.mediaUrls.length > 0
                ? inc.mediaUrls.map(m => m.type && m.type.startsWith('video/')
                    ? `<video controls src="${m.url}" style="width:100%;max-height:240px;border-radius:8px;margin-top:8px;" playsinline></video>`
                    : `<img src="${m.url}" style="width:100%; border-radius:8px; margin-top:10px; cursor:pointer;" onclick="window.open('${m.url}')">`
                ).join('')
                : (inc.imageUrl ? `<img src="${inc.imageUrl}" style="width:100%; border-radius:8px; margin-top:10px; cursor:pointer;" onclick="window.open('${inc.imageUrl}')">` : '')
            }
            ${inc.audioUrl ? `<audio controls src="${inc.audioUrl}" style="width:100%; height:30px; margin-top:10px;"></audio>` : ''}
            <div class="chat-time">${new Date(inc.timestamp).toLocaleTimeString()}</div>
        </div>`).join('') || '<p style="text-align:center; padding:20px; color:#999;">Esperando incidencias...</p>';
}

// generarLineaTiempo() reemplazado por generarReportePDF()

async function exportarAGoogleSheets() {
    if (!GOOGLE_WEBHOOK_URL) return alert("Error: GOOGLE_WEBHOOK_URL vacía.");
    const btn = document.getElementById('sync-gsheets-btn');
    btn.disabled = true; btn.innerText = "Sincronizando... ⏳";

    const dataPayload = Object.values(allSessionsOfDate).map(s => ({
        fecha: s.fecha, comisionado: s.name, oficina: s.office, protesta: s.protestName || "OD/MOD",
        punto: s.location, hora_inicio: formatTime(s.startTime), 
        hora_fin: s.endTime ? formatTime(s.endTime) : "En curso", status: s.status === 'finished' ? 'Finalizado' : 'Activo'
    }));

    try {
        await fetch(GOOGLE_WEBHOOK_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'sync_bi', data: dataPayload }) });
        alert("Sincronización exitosa ✅");
    } catch (e) { alert("Error: " + e.message); }
    finally { btn.disabled = false; btn.innerText = "🔄 Sincronizar BI"; }
}

function getIncidentColor(cls) {
    switch(cls) {
        case 'Heridos': return '#e67e22';
        case 'Fallecidos': return '#c0392b';
        case 'Privados de la libertad': return '#8e44ad';
        default: return '#3498db';
    }
}
function formatTime(ts) { return ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ""; }
function safeSetText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

function descargarCSV() {
    const sessions = allSessionsOfDate;
    if (!sessions || Object.keys(sessions).length === 0) {
        alert("No hay datos para exportar en la fecha seleccionada.");
        return;
    }

    const headers = ["Fecha", "Comisionado", "Oficina", "Protesta", "Punto", "Inicio", "Fin", "Estado"];
    const rows = Object.values(sessions).map(s => [
        s.fecha || "",
        s.name || "",
        s.office || "",
        s.protestName || "OD/MOD",
        s.location || "",
        formatTime(s.startTime),
        s.endTime ? formatTime(s.endTime) : "En curso",
        s.status === 'finished' ? 'Finalizado' : 'Activo'
    ]);

    // Escapar comas dentro de los campos
    const escape = v => '"' + String(v).replace(/"/g, '""') + '"';
    const csvContent = [headers.map(escape).join(",")]
        .concat(rows.map(r => r.map(escape).join(",")))
        .join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const fecha = document.getElementById("filter-date").value || "hoy";
    a.href = url;
    a.download = "padron_supervisiones_" + fecha + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// === GESTIÓN DE CATÁLOGOS (ADMIN) ===
const puntosPredefinidos = {
  "Espacio de movilización": ["Congreso", "Fiscalía", "Parque Universitario", "Plaza San Martín", "Plaza Dos de Mayo", "Plaza Manco Cápac", "Alameda Paseo de los Héroes Navales", "Óvalo Grau", "Óvalo Bolognesi", "Av. De la Peruanidad", "ONPE", "JNE", "Campo de Marte"],
  "Dependencia policial / Seguridad del Estado": ["Comisaría Alfonso Ugarte", "Comisaría Cotabambas", "Comisaría de Mujeres", "Comisaría PNP San Andrés", "División de Asuntos Sociales", "Comisaría de Piedra Liza"],
  "Establecimiento de salud": ["Hospital Nacional Arzobispo Loayza", "Emergencias Grau", "Hospital Nacional Guillermo Almenara", "Hospital Edgardo Rebagliati Martins", "Hospital Nacional Dos de Mayo", "Hospital PNP Augusto B. Leguía", "Hospital Nacional PNP Luis N Saenz"],
  "Videovigilancia": ["Centro de Monitoreo", "Cámaras - Municipalidad", "Cámaras - PNP"]
};

let currentCatalogos = { protestas: [], puntos: {} };

async function openCatalogosModal() {
    const modal = document.getElementById('catalogos-modal');
    modal.classList.remove('hidden-modal');
    
    // Cargar datos actuales de Firebase
    const snap = await fbRef('configuracion/catalogos').once('value');
    const data = snap.val() || { protestas: [], puntos: {} };
    
    // Normalizar estructura si está vacía
    currentCatalogos = {
        protestas: Array.isArray(data.protestas) ? data.protestas : [],
        puntos: data.puntos || {}
    };
    
    renderCatalogosLists();
}

function renderCatalogosLists() {
    // Protestas
    const pList = document.getElementById('protest-list-admin');
    pList.innerHTML = currentCatalogos.protestas.map((p, i) => `
        <div style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid #eee; align-items:center;">
            <span>${p}</span>
            <button onclick="removeProtestFromState(${i})" style="background:#e74c3c; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:0.8rem;">Eliminar</button>
        </div>
    `).join('') || '<p style="padding:10px; color:#999; text-align:center;">No hay protestas registradas.</p>';

    // Puntos
    const ptsList = document.getElementById('points-list-admin');
    let ptsHtml = "";
    const categories = ["Espacio de movilización", "Dependencia policial / Seguridad del Estado", "Establecimiento de salud", "Videovigilancia"];
    
    categories.forEach(cat => {
        const localItems = puntosPredefinidos[cat] || [];
        const remoteItems = currentCatalogos.puntos[cat] || [];
        
        ptsHtml += `<div style="background:#eee; padding:5px 10px; font-weight:700; font-size:0.8rem;">${cat}</div>`;
        
        // Mostrar puntos base (solo lectura)
        localItems.forEach(item => {
            ptsHtml += `
                <div style="display:flex; justify-content:space-between; padding:8px 10px; border-bottom:1px solid #eee; align-items:center; background:#f9f9f9; color:#666;">
                    <span style="font-size:0.85rem;">📍 ${item} <small style="color:#999;">(Base Lima)</small></span>
                </div>
            `;
        });

        // Mostrar puntos dinámicos (eliminables)
        remoteItems.forEach((item, idx) => {
            ptsHtml += `
                <div style="display:flex; justify-content:space-between; padding:8px 10px; border-bottom:1px solid #eee; align-items:center; background:white;">
                    <span style="font-size:0.9rem;">${item}</span>
                    <button onclick="removePointFromState('${cat}', ${idx})" style="background:#e74c3c; color:white; border:none; padding:3px 6px; border-radius:4px; cursor:pointer; font-size:0.75rem;">&times;</button>
                </div>
            `;
        });
        
        if (localItems.length === 0 && remoteItems.length === 0) {
            ptsHtml += `<p style="padding:10px; color:#999; font-size:0.8rem;">Sin puntos en esta categoría.</p>`;
        }
    });
    ptsList.innerHTML = ptsHtml;
}

function addProtestToState() {
    const input = document.getElementById('new-protest-name');
    const name = input.value.trim();
    if (!name) return;
    if (currentCatalogos.protestas.includes(name)) return alert("Ya existe.");
    currentCatalogos.protestas.push(name);
    input.value = "";
    renderCatalogosLists();
}

function removeProtestFromState(index) {
    currentCatalogos.protestas.splice(index, 1);
    renderCatalogosLists();
}

function addPointToState() {
    const cat = document.getElementById('new-point-category').value;
    const input = document.getElementById('new-point-name');
    const name = input.value.trim();
    if (!name) return;
    
    if (!currentCatalogos.puntos[cat]) currentCatalogos.puntos[cat] = [];
    
    // Validar duplicados en local y remoto
    const isLocal = (puntosPredefinidos[cat] || []).includes(name);
    const isRemote = currentCatalogos.puntos[cat].includes(name);
    
    if (isLocal || isRemote) return alert("Ya existe en esta categoría.");
    
    currentCatalogos.puntos[cat].push(name);
    input.value = "";
    renderCatalogosLists();
}

function removePointFromState(cat, index) {
    currentCatalogos.puntos[cat].splice(index, 1);
    renderCatalogosLists();
}

async function saveCatalogosToFirebase() {
    const btn = document.getElementById('save-catalogos-btn');
    btn.disabled = true; btn.textContent = "Guardando... ⏳";
    
    try {
        await fbRef('configuracion/catalogos').set(currentCatalogos);
        alert("Catálogos actualizados correctamente ✅");
        document.getElementById('catalogos-modal').classList.add('hidden-modal');
    } catch (e) {
        alert("Error al guardar: " + e.message);
    } finally {
        btn.disabled = false; btn.textContent = "Guardar Cambios ✅";
    }
}

// Exponer funciones globales para los botones de eliminar (onclick)
window.removeProtestFromState = removeProtestFromState;
window.removePointFromState = removePointFromState;

// =============================================
// GENERADOR DE REPORTE PDF
// =============================================
async function generarReportePDF(observaciones = '', coordinador = '') {
    const btn = document.getElementById('pdf-generar-btn');
    const headerBtn = document.getElementById('btn-generar-pdf');
    if (headerBtn) { headerBtn.disabled = true; headerBtn.textContent = '⏳ Generando...'; }

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const W = 210; // ancho A4
        const MARGIN = 14;
        const COL_W = W - MARGIN * 2;
        let y = 0;

        // ---------- COLORES ----------
        const AZUL_DP   = [0, 51, 102];    // #003366
        const BLANCO    = [255, 255, 255];
        const GRIS_CLR  = [245, 247, 250];
        const GRIS_TXT  = [100, 100, 110];
        const ROJO      = [192, 57, 43];
        const VERDE     = [39, 174, 96];
        const NARANJA   = [230, 126, 34];
        const MORADO    = [142, 68, 173];

        // ========== LOGOS ==========
        const logos = await cargarLogos();

        // ========== ENCABEZADO ==========
        const HDR = 40;
        doc.setFillColor(...AZUL_DP);
        doc.rect(0, 0, W, HDR, 'F');

        // Logo DP (izquierda)
        const dpW = 34, dpH = 30;
        if (logos.logoDP) doc.addImage(logos.logoDP.data, logos.logoDP.fmt, MARGIN, (HDR - dpH) / 2, dpW, dpH);

        // Logo 30 años (derecha, sin fondo — negro eliminado vía canvas)
        const l30W = 24, l30H = 22;
        const l30X = W - MARGIN - l30W;
        const l30Y = (HDR - l30H) / 2;
        if (logos.logo30) doc.addImage(logos.logo30.data, logos.logo30.fmt, l30X, l30Y, l30W, l30H);

        // Textos centrados
        doc.setTextColor(...BLANCO);
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'normal');
        doc.text('Adjunto para la Prevención de Conflictos Sociales y la Gobernabilidad', W / 2, 10, { align: 'center' });
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Reporte Diario de Supervisión de Campo', W / 2, 19, { align: 'center' });
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.text('Defensoría del Pueblo del Perú', W / 2, 26, { align: 'center' });

        // Fecha y turno (bajo el título, izquierda)
        const fechaFiltro = document.getElementById('filter-date')?.value || new Date().toISOString().split('T')[0];
        const [anio, mes, dia] = fechaFiltro.split('-');
        const fechaLegible = `${dia}/${mes}/${anio}`;
        const protestFiltro = document.getElementById('filter-protest')?.value;
        const turnoLabel = protestFiltro && protestFiltro !== 'all' ? protestFiltro : 'Todas las movilizaciones';

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...BLANCO);
        doc.text(`${fechaLegible}  ·  ${turnoLabel}`, W / 2, 33, { align: 'center' });
        const horaGen = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
        doc.setFontSize(6.5);
        doc.setTextColor(200, 215, 235);
        doc.text(`Generado: ${horaGen}`, W - MARGIN, 37, { align: 'right' });

        y = 48;

        // ========== DATOS DE SESIONES ==========
        const sessions = Object.values(allSessionsOfDate);
        let totalIncidencias = 0, heridos = 0, fallecidos = 0, detenidos = 0;
        let allIncidents = [];

        sessions.forEach(s => {
            if (s.incidents) {
                Object.values(s.incidents).forEach(inc => {
                    totalIncidencias++;
                    if (inc.clasificacion === 'Heridos')                 heridos += parseInt(inc.cantidad || 1);
                    if (inc.clasificacion === 'Fallecidos')               fallecidos += parseInt(inc.cantidad || 1);
                    if (inc.clasificacion === 'Privados de la libertad') detenidos += parseInt(inc.cantidad || 1);
                    allIncidents.push({ ...inc, sessionName: s.name, sessionOffice: s.office, sessionLocation: s.location });
                });
            }
        });
        allIncidents.sort((a, b) => a.timestamp - b.timestamp);

        // ========== BLOQUE RESUMEN ==========
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...GRIS_TXT);
        doc.text('RESUMEN DEL DÍA', MARGIN, y);
        y += 4;
        doc.setDrawColor(220, 225, 235);
        doc.line(MARGIN, y, W - MARGIN, y);
        y += 5;

        const stats = [
            { label: 'Supervisiones', value: sessions.length, color: VERDE },
            { label: 'Incidencias', value: totalIncidencias, color: [24, 95, 165] },
            { label: 'Heridos', value: heridos, color: NARANJA },
            { label: 'Priv. Libertad', value: detenidos, color: MORADO },
            { label: 'Fallecidos', value: fallecidos, color: ROJO },
        ];
        const boxW = COL_W / 5 - 2;
        stats.forEach((s, i) => {
            const bx = MARGIN + i * (boxW + 2.5);
            doc.setFillColor(...GRIS_CLR);
            doc.roundedRect(bx, y, boxW, 18, 2, 2, 'F');
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...s.color);
            doc.text(String(s.value), bx + boxW / 2, y + 10, { align: 'center' });
            doc.setFontSize(6.5);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...GRIS_TXT);
            doc.text(s.label, bx + boxW / 2, y + 15.5, { align: 'center' });
        });
        y += 26;

        // ========== LÍNEA DE TIEMPO ==========
        if (allIncidents.length > 0) {
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...GRIS_TXT);
            doc.text('LÍNEA DE TIEMPO DE INCIDENCIAS', MARGIN, y);
            y += 4;
            doc.setDrawColor(220, 225, 235);
            doc.line(MARGIN, y, W - MARGIN, y);
            y += 5;

            const incColors = {
                'Heridos':                  { bg: [252, 235, 235], text: [163, 45, 45] },
                'Fallecidos':               { bg: [252, 235, 235], text: [120, 20, 20] },
                'Privados de la libertad':  { bg: [238, 237, 254], text: [83, 74, 183] },
                'Reporte de Situación':     { bg: [230, 241, 251], text: [24, 95, 165] },
                'Enfrentamientos':          { bg: [250, 238, 218], text: [186, 117, 23] },
                'PÁNICO':                   { bg: [252, 235, 235], text: [192, 57, 43] },
            };

            for (const inc of allIncidents) {
                const lineH = 16;
                if (y + lineH > 270) { doc.addPage(); y = 20; }

                const timeStr = new Date(inc.timestamp).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
                const colors = incColors[inc.clasificacion] || { bg: [240, 243, 247], text: [60, 60, 70] };

                // Línea fondo
                doc.setFillColor(...GRIS_CLR);
                doc.rect(MARGIN, y, COL_W, lineH, 'F');

                // Hora
                doc.setFontSize(7.5);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...AZUL_DP);
                doc.text(timeStr, MARGIN + 2, y + 5.5);

                // Badge clasificación
                const tagW = 36;
                doc.setFillColor(...colors.bg);
                doc.roundedRect(MARGIN + 14, y + 1.5, tagW, 6, 1.5, 1.5, 'F');
                doc.setFontSize(6);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...colors.text);
                const tagTxt = inc.clasificacion + (inc.cantidad ? ` (${inc.cantidad})` : '');
                doc.text(tagTxt, MARGIN + 14 + tagW / 2, y + 5.8, { align: 'center' });

                // Descripción
                const descRaw = (inc.description || '').replace(/^[^-]+-\s*/, '');
                const descLines = doc.splitTextToSize(descRaw.substring(0, 140), COL_W - 60);
                doc.setFontSize(7);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(40, 40, 50);
                doc.text(descLines[0] || '', MARGIN + 54, y + 5.5);

                // Autor / lugar
                doc.setFontSize(6.2);
                doc.setTextColor(...GRIS_TXT);
                doc.text(`${inc.sessionName}  ·  ${inc.sessionLocation}`, MARGIN + 2, y + 12);

                y += lineH + 1.5;
            }
            y += 4;
        }

        // ========== PADRÓN DE COMISIONADOS ==========
        if (y + 20 > 270) { doc.addPage(); y = 20; }

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...GRIS_TXT);
        doc.text('PADRÓN DE COMISIONADOS', MARGIN, y);
        y += 4;
        doc.setDrawColor(220, 225, 235);
        doc.line(MARGIN, y, W - MARGIN, y);
        y += 3;

        const tableRows = sessions
            .sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
            .map(s => {
                const nInc = s.incidents ? Object.keys(s.incidents).length : 0;
                const hasCrit = s.incidents ? Object.values(s.incidents).some(i => ['Heridos','Fallecidos','Privados de la libertad','PÁNICO'].includes(i.clasificacion)) : false;
                return [
                    s.name || '—',
                    s.office ? s.office.replace('Adjuntía para la Prevención de Conflictos Sociales y la Gobernabilidad', 'Adjuntía APCSG') : '—',
                    s.location || '—',
                    formatTime(s.startTime),
                    s.endTime ? formatTime(s.endTime) : 'En curso',
                    nInc + (hasCrit ? ' 🚨' : ''),
                    s.status === 'finished' ? 'Finalizado' : 'Activo'
                ];
            });

        doc.autoTable({
            startY: y,
            head: [['Comisionado', 'Oficina', 'Punto', 'Inicio', 'Fin', 'Rep.', 'Estado']],
            body: tableRows,
            styles: { fontSize: 7, cellPadding: 2.5, textColor: [40, 40, 50] },
            headStyles: { fillColor: AZUL_DP, textColor: BLANCO, fontStyle: 'bold', fontSize: 7 },
            alternateRowStyles: { fillColor: GRIS_CLR },
            columnStyles: {
                0: { cellWidth: 32 },
                1: { cellWidth: 36 },
                2: { cellWidth: 38 },
                3: { cellWidth: 14 },
                4: { cellWidth: 14 },
                5: { cellWidth: 10, halign: 'center' },
                6: { cellWidth: 18, halign: 'center' },
            },
            margin: { left: MARGIN, right: MARGIN },
            didDrawCell: (data) => {
                if (data.section === 'body' && data.column.index === 6) {
                    const val = data.cell.raw;
                    if (val === 'Activo') {
                        doc.setTextColor(...VERDE);
                    } else {
                        doc.setTextColor(...GRIS_TXT);
                    }
                }
            }
        });

        y = doc.lastAutoTable.finalY + 8;

        // ========== OBSERVACIONES ==========
        if (y + 30 > 270) { doc.addPage(); y = 20; }

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...GRIS_TXT);
        doc.text('OBSERVACIONES GENERALES', MARGIN, y);
        y += 4;
        doc.setDrawColor(220, 225, 235);
        doc.line(MARGIN, y, W - MARGIN, y);
        y += 4;

        const obsH = 22;
        doc.setFillColor(...GRIS_CLR);
        doc.rect(MARGIN, y, COL_W, obsH, 'F');

        if (observaciones) {
            const obsLines = doc.splitTextToSize(observaciones, COL_W - 8);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(40, 40, 50);
            doc.text(obsLines, MARGIN + 4, y + 6);
        }
        y += obsH + 10;

        // ========== FIRMAS ==========
        if (y + 28 > 277) { doc.addPage(); y = 20; }

        const signW = 55;
        const gap = (COL_W - signW * 2) / 3;

        // Línea firma izquierda
        const x1 = MARGIN + gap;
        doc.setDrawColor(150, 155, 165);
        doc.line(x1, y + 18, x1 + signW, y + 18);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...AZUL_DP);
        if (coordinador) doc.text(coordinador, x1 + signW / 2, y + 14, { align: 'center' });
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...GRIS_TXT);
        doc.text('Coordinador de turno', x1 + signW / 2, y + 22, { align: 'center' });

        // Línea firma derecha
        const x2 = MARGIN + gap * 2 + signW;
        doc.setDrawColor(150, 155, 165);
        doc.line(x2, y + 18, x2 + signW, y + 18);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...GRIS_TXT);
        doc.text('Adjunto para la Prevención de Conflictos Sociales y la Gobernabilidad', x2 + signW / 2, y + 22, { align: 'center' });

        // ========== PIE DE PÁGINA en todas las páginas ==========
        const totalPages = doc.internal.getNumberOfPages();
        for (let p = 1; p <= totalPages; p++) {
            doc.setPage(p);
            doc.setFontSize(6.5);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...GRIS_TXT);
            doc.text(
                `Defensoría del Pueblo  ·  Sistema de Supervisión v4.0  ·  ${p} / ${totalPages}`,
                W / 2, 290, { align: 'center' }
            );
            // Línea separadora pie
            doc.setDrawColor(200, 205, 215);
            doc.line(MARGIN, 286, W - MARGIN, 286);
        }

        // ========== DESCARGAR ==========
        const nombreArchivo = `reporte_supervision_${fechaFiltro}.pdf`;
        doc.save(nombreArchivo);
        showToast('✅ PDF generado: ' + nombreArchivo, '#27ae60');

    } catch (e) {
        console.error('[PDF] Error:', e);
        alert('Error al generar PDF: ' + e.message);
    } finally {
        if (headerBtn) { headerBtn.disabled = false; headerBtn.textContent = '📄 Reporte PDF'; }
    }
}

// =============================================
// HELPER: CARGA DE LOGOS PARA PDF
// =============================================
let _cachedLogos = null; // se resetea al recargar la página

async function cargarLogos() {
    if (_cachedLogos) return _cachedLogos;

    const toEntry = src => new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', src, true);
        xhr.responseType = 'blob';
        xhr.onload = () => {
            // status 0 = file://, 200 = http
            if (xhr.status === 200 || xhr.status === 0) {
                const reader = new FileReader();
                reader.onload = () => {
                    const dataUrl = reader.result;
                    const mime = (dataUrl.split(';')[0].split(':')[1] || '').toLowerCase();
                    const fmt = (mime.includes('jpeg') || mime.includes('jpg')) ? 'JPEG' : 'PNG';
                    console.log(`[Logo OK] ${src} → ${fmt}`);
                    resolve({ data: dataUrl, fmt });
                };
                reader.onerror = () => { console.warn('[Logo] FileReader falló:', src); resolve(null); };
                reader.readAsDataURL(xhr.response);
            } else {
                console.warn(`[Logo] HTTP ${xhr.status} para ${src}`);
                resolve(null);
            }
        };
        xhr.onerror = () => { console.warn('[Logo] XHR error:', src); resolve(null); };
        xhr.send();
    });

    let [logoDP, logo30raw] = await Promise.all([
        toEntry('./logodpblanco.png'),
        toEntry('./30blanco.jpeg')
    ]);

    // Eliminar fondo negro del logo 30 usando canvas
    let logo30 = null;
    if (logo30raw) {
        try {
            const pngData = await new Promise(resolve => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const d = id.data;
                    for (let i = 0; i < d.length; i += 4) {
                        // Si el píxel es negro o casi negro → transparente
                        if (d[i] < 80 && d[i+1] < 80 && d[i+2] < 80) d[i+3] = 0;
                    }
                    ctx.putImageData(id, 0, 0);
                    resolve(canvas.toDataURL('image/png'));
                };
                img.onerror = () => resolve(null);
                img.src = logo30raw.data;
            });
            if (pngData) logo30 = { data: pngData, fmt: 'PNG' };
        } catch (e) {
            console.warn('[Logo30] Canvas processing falló, usando original', e);
            logo30 = logo30raw;
        }
    }

    console.log('[Logos cargados]', { logoDP: !!logoDP, logo30: !!logo30 });
    _cachedLogos = { logoDP, logo30 };
    return _cachedLogos;
}

function showToast(message, color = '#2c3e50') {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; top: 80px; right: 15px; z-index: 9999;
        background: ${color}; color: white; border-radius: 12px;
        padding: 12px 18px; font-size: 0.85rem; font-weight: 700;
        box-shadow: 0 4px 15px rgba(0,0,0,0.25); max-width: 320px;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

initDashboard();

// =============================================
// MÓDULO: REGISTROS ACP & ALERTAS (Admin)
// =============================================

let _allRegistros = [];      // todos los registros combinados
let _registrosFiltrados = []; // tras aplicar filtros

function switchAdminTab(tab, btnEl) {
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');

    const panels = { supervision: 'panel-supervision', registros: 'panel-registros', compensacion: 'panel-compensacion' };
    Object.entries(panels).forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = (key === tab) ? 'block' : 'none';
    });

    if (tab === 'registros') loadRegistros();
    if (tab === 'compensacion' && typeof initCompensacionModule === 'function') initCompensacionModule();
}

function loadRegistros() {
    _allRegistros = [];
    let alertasDone = false, acpDone = false;

    const refAlertas = fbRef('alertas');
    const refAcp = fbRef('acciones_colectivas');
    if (!refAlertas || !refAcp) return;

    refAlertas.orderByChild('timestamp').limitToLast(200).once('value', snap => {
        const data = snap.val() || {};
        Object.entries(data).forEach(([id, v]) => {
            _allRegistros.push({ id, _tipo: 'alerta', ...v });
        });
        alertasDone = true;
        if (acpDone) renderTablaRegistros();
    });

    refAcp.orderByChild('timestamp').limitToLast(200).once('value', snap => {
        const data = snap.val() || {};
        Object.entries(data).forEach(([id, v]) => {
            _allRegistros.push({ id, _tipo: 'acp', ...v });
        });
        acpDone = true;
        if (alertasDone) renderTablaRegistros();
    });
}

function renderTablaRegistros() {
    // Aplicar filtros
    const tipo = document.getElementById('filtro-tipo-registro')?.value || 'all';
    const desde = document.getElementById('filtro-fecha-desde')?.value;
    const hasta = document.getElementById('filtro-fecha-hasta')?.value;
    const busqueda = (document.getElementById('filtro-busqueda')?.value || '').toLowerCase();

    _registrosFiltrados = _allRegistros.filter(r => {
        if (tipo !== 'all' && r._tipo !== tipo) return false;
        const fecha = r.fechaEvento || r.fecha || '';
        if (desde && fecha && fecha < desde) return false;
        if (hasta && fecha && fecha > hasta) return false;
        if (busqueda && !(r.nombreEvento || '').toLowerCase().includes(busqueda)) return false;
        return true;
    });

    // Ordenar por fecha desc
    _registrosFiltrados.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const tbody = document.getElementById('tabla-registros-body');
    const count = document.getElementById('registros-count');
    if (!tbody) return;

    if (count) count.textContent = _registrosFiltrados.length;

    if (!_registrosFiltrados.length) {
        tbody.innerHTML = '<tr><td colspan="10" class="registros-empty">No hay registros que coincidan con los filtros.</td></tr>';
        return;
    }

    tbody.innerHTML = _registrosFiltrados.map(r => {
        const esAlerta = r._tipo === 'alerta';
        const fecha = r.fechaEvento || r.fecha || (r.timestamp ? new Date(r.timestamp).toLocaleDateString('es-PE') : '—');
        const tipoBadge = esAlerta
            ? '<span class="badge-tipo badge-alerta">🚨 Alerta</span>'
            : '<span class="badge-tipo badge-acp">🤝 ACP</span>';

        const clasificacion = esAlerta
            ? (r.clasificacion || '—')
            : (r.huboViolencia === 'Sí'
                ? '<span class="badge-tipo badge-violencia">Con violencia</span>'
                : '<span class="badge-tipo badge-ok">Sin violencia</span>');

        const fuente = r.fuenteInfo || '—';
        const enlace = r.linkFuente
            ? `<a href="${r.linkFuente}" target="_blank" class="link-fuente">🔗 Ver</a>`
            : '—';

        const ubicacion = (r.ubicaciones || []).map(u => u.departamento).filter(Boolean).join(', ') || '—';
        const personas = r.cantidadPersonas || 0;
        const riesgo = esAlerta ? (r.nivelRiesgo || '—') : '—';
        const registradoPor = r.registradoPor || '—';

        return `<tr>
            <td>${tipoBadge}</td>
            <td>${fecha}</td>
            <td style="font-weight:600;">${r.nombreEvento || '—'}</td>
            <td>${clasificacion}</td>
            <td>${fuente}</td>
            <td>${enlace}</td>
            <td style="color:#555;">${ubicacion}</td>
            <td style="text-align:center;">${personas}</td>
            <td>${riesgo}</td>
            <td style="color:#777; font-size:0.78rem;">${registradoPor}</td>
        </tr>`;
    }).join('');
}

function aplicarFiltrosRegistros() {
    renderTablaRegistros();
}

function limpiarFiltrosRegistros() {
    const ids = ['filtro-tipo-registro', 'filtro-fecha-desde', 'filtro-fecha-hasta', 'filtro-busqueda'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = el.tagName === 'SELECT' ? 'all' : '';
    });
    renderTablaRegistros();
}

// Exportar CSV
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-export-registros')?.addEventListener('click', exportarRegistrosCSV);
});

function exportarRegistrosCSV() {
    if (!_registrosFiltrados.length) return alert('No hay registros para exportar.');
    const headers = ['Tipo', 'Fecha', 'Nombre del Evento', 'Clasificación/Violencia', 'Fuente', 'Enlace', 'Ubicación', 'Personas', 'Nivel Riesgo', 'Registrado por'];
    const rows = _registrosFiltrados.map(r => {
        const fecha = r.fechaEvento || r.fecha || '';
        const clasificacion = r._tipo === 'alerta' ? (r.clasificacion || '') : (r.huboViolencia || '');
        const ubicacion = (r.ubicaciones || []).map(u => u.departamento).filter(Boolean).join(' / ');
        return [
            r._tipo === 'alerta' ? 'Alerta' : 'ACP',
            fecha,
            r.nombreEvento || '',
            clasificacion,
            r.fuenteInfo || '',
            r.linkFuente || '',
            ubicacion,
            r.cantidadPersonas || 0,
            r._tipo === 'alerta' ? (r.nivelRiesgo || '') : '',
            r.registradoPor || ''
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `registros_acp_alertas_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('✅ CSV exportado correctamente', '#27ae60');
}

window.switchAdminTab = switchAdminTab;
window.aplicarFiltrosRegistros = aplicarFiltrosRegistros;
window.limpiarFiltrosRegistros = limpiarFiltrosRegistros;

// =============================================
// GENERADOR: REPORTE PDF DE ALERTAS Y ACP
// Formato: A4 Horizontal — estilo institucional
// =============================================

async function generarReporteAlertasACP() {
    const btn = document.getElementById('btn-reporte-alertas-acp');
    if (btn) { btn.disabled = true; btn.textContent = 'Generando... ⏳'; }

    try {
        const { jsPDF } = window.jspdf;
        // ── A4 LANDSCAPE ──────────────────────────
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const logos = await cargarLogos();

        const W      = 297;   // ancho A4 landscape
        const H      = 210;   // alto  A4 landscape
        const MARGIN = 13;
        const COL_W  = W - MARGIN * 2;

        // ── PALETA ────────────────────────────────
        const AZUL_DP   = [0,  51, 102];
        const AZUL_HDR  = [13, 71, 161];   // cabecera de tabla
        const BLANCO    = [255, 255, 255];
        const GRIS_CLR  = [247, 249, 252];
        const GRIS_TXT  = [80,  85,  95];
        const GRIS_LINE = [210, 215, 225];
        const ROJO      = [192,  57,  43];
        const NARANJA   = [211,  84,   0];
        const AMARILLO  = [183, 149,   0];
        const VERDE     = [ 30, 130,  76];

        // ── FECHA ─────────────────────────────────
        const ahora   = new Date();
        const year    = ahora.getFullYear();
        const DIAS    = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
        const MESES   = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto',
                         'septiembre','octubre','noviembre','diciembre'];
        const fechaLarga = `${DIAS[ahora.getDay()]}, ${ahora.getDate()} de ${MESES[ahora.getMonth()]} de ${year}`;
        const numDia     = String(ahora.getDate()).padStart(2, '0');
        const numMes     = String(ahora.getMonth() + 1).padStart(2, '0');
        const fechaCorta = `${ahora.getFullYear()}-${numMes}-${numDia}`;

        // ── RANGO DE FECHAS DEL FILTRO ────────────
        const filtroDesde = document.getElementById('filtro-fecha-desde')?.value;
        const filtroHasta = document.getElementById('filtro-fecha-hasta')?.value;
        const formatFechaCorta = f => {
            if (!f) return null;
            const [y, m, d] = f.split('-');
            return `${d}/${m}/${y}`;
        };
        let periodoTitulo = fechaLarga;
        if (filtroDesde && filtroHasta) {
            periodoTitulo = `Del ${formatFechaCorta(filtroDesde)} al ${formatFechaCorta(filtroHasta)}`;
        } else if (filtroDesde) {
            periodoTitulo = `Desde el ${formatFechaCorta(filtroDesde)}`;
        } else if (filtroHasta) {
            periodoTitulo = `Hasta el ${formatFechaCorta(filtroHasta)}`;
        }

        // ── REGISTROS ─────────────────────────────
        const alertas = _allRegistros
            .filter(r => r._tipo === 'alerta')
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        const acps = _allRegistros
            .filter(r => r._tipo === 'acp')
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        // ── COLORES POR NIVEL DE RIESGO ───────────
        function riesgoStyle(nivel) {
            const n = (nivel || '').toLowerCase();
            if (n.includes('muy alto'))                          return { text: ROJO,     bg: [253,237,236] };
            if (n.includes('alto'))                              return { text: NARANJA,  bg: [253,245,236] };
            if (n.includes('medio') || n.includes('intermedio')) return { text: AMARILLO, bg: [254,249,231] };
            if (n.includes('bajo'))                              return { text: VERDE,    bg: [234,250,241] };
            return { text: GRIS_TXT, bg: BLANCO };
        }

        // ─────────────────────────────────────────
        // ENCABEZADO DE PÁGINA
        // ─────────────────────────────────────────
        function drawHeader(subtitulo) {
            const HDR_H = 36;

            // Banda azul superior completa
            doc.setFillColor(...AZUL_DP);
            doc.rect(0, 0, W, HDR_H, 'F');

            // ── LOGO DP (izquierda) ───────────────────
            const logoW = 30, logoH = 26;
            if (logos.logoDP) {
                doc.addImage(logos.logoDP.data, logos.logoDP.fmt, MARGIN, (HDR_H - logoH) / 2, logoW, logoH);
            }

            // ── LOGO 30 AÑOS (derecha, sin fondo — negro eliminado vía canvas) ──
            const l30W = 24, l30H = 22;
            const l30X = W - MARGIN - l30W;
            const l30Y = (HDR_H - l30H) / 2;
            if (logos.logo30) {
                doc.addImage(logos.logo30.data, logos.logo30.fmt, l30X, l30Y, l30W, l30H);
            }

            // ── TEXTO CENTRO ──────────────────────────
            const textX = MARGIN + logoW + 6;
            const textMaxW = l30X - textX - 4;

            doc.setTextColor(...BLANCO);
            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            doc.text('Adjuntía para la Prevención de Conflictos Sociales y la Gobernabilidad',
                W / 2, 9, { align: 'center' });

            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.text('REPORTE DE ALERTAS DEFENSORIALES', W / 2, 18, { align: 'center' });

            doc.setFontSize(7.5);
            doc.setFont('helvetica', 'normal');
            doc.text('Unidad Funcional de Prevención y Alertas', W / 2, 24, { align: 'center' });

            // Periodo / fecha
            doc.setFontSize(7.5);
            doc.setFont('helvetica', 'bold');
            doc.text(periodoTitulo, W / 2, 31, { align: 'center' });

            // Subtítulo de sección (banda gris bajo el header)
            if (subtitulo) {
                doc.setFillColor(240, 244, 250);
                doc.rect(0, HDR_H, W, 8, 'F');
                doc.setTextColor(...AZUL_DP);
                doc.setFontSize(8.5);
                doc.setFont('helvetica', 'bold');
                doc.text(subtitulo, MARGIN, HDR_H + 5.5);
            }
        }

        // ─────────────────────────────────────────
        // PIE DE PÁGINA
        // ─────────────────────────────────────────
        function drawFooter(pageNum, total) {
            doc.setDrawColor(...GRIS_LINE);
            doc.line(MARGIN, H - 10, W - MARGIN, H - 10);
            doc.setFontSize(6.5);
            doc.setTextColor(...GRIS_TXT);
            doc.setFont('helvetica', 'normal');
            doc.text(
                'Defensoría del Pueblo del Perú  ·  Adjuntía para la Prevención de Conflictos Sociales y la Gobernabilidad',
                MARGIN, H - 6
            );
            doc.text(`Página ${pageNum} de ${total}`, W - MARGIN, H - 6, { align: 'right' });
        }

        // ─────────────────────────────────────────
        // PÁGINA 1 — ALERTAS DEFENSORIALES
        // ─────────────────────────────────────────
        const subAlertas = `1.   Registro de alertas defensoriales`;
        drawHeader(subAlertas);
        let y = 50;

        if (alertas.length > 0) {
            const rows = alertas.map((r, i) => {
                const codigo  = `AlerT ${String(i + 1).padStart(3,'0')}-${year}`;
                const ubic    = (r.ubicaciones || []).map(u =>
                    [u.departamento, u.provincia, u.distrito].filter(Boolean).join(', ')
                ).join('\n') || '—';
                const actores = (r.actores || []).map(a => a.nombre || a.tipo || '').filter(Boolean).join('\n') || '—';
                const demanda = r.demandas || r.descripcion || '—';
                const medida  = r.tipoMedida || (r.fechaEvento ? `Sin medida definida\n${r.fechaEvento}` : '—');
                const fuente  = [r.fuenteInfo, r.linkFuente ? r.linkFuente : ''].filter(Boolean).join('\n') || '—';
                const riesgo  = r.nivelRiesgo || '—';
                return [codigo, r.clasificacion || '—', ubic, actores, demanda, medida, fuente, riesgo];
            });

            doc.autoTable({
                startY: y,
                head: [['Código','Clasificación de alerta','Ubicación\n(Dpto., Provincia, Distrito)','Actores','Demandas','Medida de protesta','Fuente','Riesgo*']],
                body: rows,
                styles: {
                    fontSize: 7,
                    cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
                    textColor: [40, 45, 55],
                    valign: 'top',
                    overflow: 'linebreak',
                    lineColor: GRIS_LINE,
                    lineWidth: 0.15,
                },
                headStyles: {
                    fillColor: AZUL_HDR,
                    textColor: BLANCO,
                    fontStyle: 'bold',
                    fontSize: 7,
                    cellPadding: { top: 4, right: 3, bottom: 4, left: 3 },
                    halign: 'center',
                    valign: 'middle',
                },
                alternateRowStyles: { fillColor: GRIS_CLR },
                columnStyles: {
                    0: { cellWidth: 24, halign: 'center', fontStyle: 'bold' },
                    1: { cellWidth: 34 },
                    2: { cellWidth: 36 },
                    3: { cellWidth: 36 },
                    4: { cellWidth: 62 },
                    5: { cellWidth: 34 },
                    6: { cellWidth: 26 },
                    7: { cellWidth: 15, halign: 'center', fontStyle: 'bold' },
                },
                margin: { left: MARGIN, right: MARGIN },
                didParseCell: data => {
                    if (data.section === 'body' && data.column.index === 7) {
                        const s = riesgoStyle(data.cell.raw);
                        data.cell.styles.textColor    = s.text;
                        data.cell.styles.fillColor    = s.bg;
                        data.cell.styles.fontStyle    = 'bold';
                    }
                },
                // Repetir header en cada página nueva de esta sección
                showHead: 'everyPage',
                didDrawPage: data => {
                    const pg = doc.getNumberOfPages();
                    drawFooter(pg, '—');
                    // Si no es la primera página de la sección, redibujar encabezado
                    if (data.pageNumber > 1) {
                        drawHeader(subAlertas);
                    }
                }
            });

            y = doc.lastAutoTable.finalY + 5;

            // Nota metodológica
            doc.setFontSize(6.2);
            doc.setTextColor(...GRIS_TXT);
            doc.setFont('helvetica', 'italic');
            const nota1 = `*El nivel de riesgo se determina evaluando: (i) impacto en la afectación de los derechos fundamentales y (p) probabilidad de que el evento ocurra.`;
            const nota2 = `**Las alertas referidas a pronunciamientos, memoriales u otros documentos que dan a conocer demandas sociales se publican por única vez en la alerta del día.`;
            doc.text(doc.splitTextToSize(nota1, COL_W), MARGIN, y);
            y += 5;
            doc.text(doc.splitTextToSize(nota2, COL_W), MARGIN, y);
        } else {
            doc.setFontSize(8.5);
            doc.setTextColor(...GRIS_TXT);
            doc.setFont('helvetica', 'italic');
            doc.text('No hay alertas defensoriales registradas para el período seleccionado.', MARGIN, y + 8);
            y += 18;
        }

        // ─────────────────────────────────────────
        // SECCIÓN ACP (nueva página si es necesario)
        // ─────────────────────────────────────────
        if (acps.length > 0) {
            doc.addPage();
            const subACP = `2.   Registro de Acciones Colectivas de Protesta (ACP)`;
            drawHeader(subACP);
            y = 50;

            const acpRows = acps.map((r, i) => {
                const codigo  = `ACP ${String(i + 1).padStart(3,'0')}-${year}`;
                const ubic    = (r.ubicaciones || []).map(u =>
                    [u.departamento, u.provincia, u.distrito].filter(Boolean).join(', ')
                ).join('\n') || '—';
                const actores = (r.actores || []).map(a => a.nombre || a.tipo || '').filter(Boolean).join('\n') || '—';
                const demanda = r.demandas || r.descripcion || '—';
                const medida  = r.tipoMedida || '—';
                const viol    = r.huboViolencia || '—';
                const heridos = (r.heridas   || []).length ? String((r.heridas   || []).length) : '0';
                const deteni  = (r.detenidas || []).length ? String((r.detenidas || []).length) : '0';
                const fuente  = [r.fuenteInfo, r.linkFuente ? r.linkFuente : ''].filter(Boolean).join('\n') || '—';
                return [codigo, r.nombreEvento || '—', r.fechaEvento || '—', ubic, actores, demanda, medida, viol, heridos, deteni, fuente];
            });

            doc.autoTable({
                startY: y,
                head: [['Código','Evento','Fecha','Ubicación','Actores','Demandas','Medida','Violencia','Heridos','Detenidos','Fuente']],
                body: acpRows,
                styles: {
                    fontSize: 7,
                    cellPadding: { top: 3, right: 2, bottom: 3, left: 2 },
                    textColor: [40, 45, 55],
                    valign: 'top',
                    overflow: 'linebreak',
                    lineColor: GRIS_LINE,
                    lineWidth: 0.15,
                },
                headStyles: {
                    fillColor: AZUL_HDR,
                    textColor: BLANCO,
                    fontStyle: 'bold',
                    fontSize: 7,
                    cellPadding: { top: 4, right: 2, bottom: 4, left: 2 },
                    halign: 'center',
                    valign: 'middle',
                },
                alternateRowStyles: { fillColor: GRIS_CLR },
                columnStyles: {
                    0:  { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
                    1:  { cellWidth: 32 },
                    2:  { cellWidth: 18, halign: 'center' },
                    3:  { cellWidth: 32 },
                    4:  { cellWidth: 28 },
                    5:  { cellWidth: 52 },
                    6:  { cellWidth: 28 },
                    7:  { cellWidth: 15, halign: 'center', fontStyle: 'bold' },
                    8:  { cellWidth: 13, halign: 'center' },
                    9:  { cellWidth: 13, halign: 'center' },
                    10: { cellWidth: 16 },
                },
                margin: { left: MARGIN, right: MARGIN },
                didParseCell: data => {
                    if (data.section === 'body' && data.column.index === 7) {
                        if ((data.cell.raw || '').toLowerCase() === 'sí') {
                            data.cell.styles.textColor = ROJO;
                            data.cell.styles.fontStyle = 'bold';
                            data.cell.styles.fillColor = [253, 237, 236];
                        }
                    }
                    if (data.section === 'body' && (data.column.index === 8 || data.column.index === 9)) {
                        const val = parseInt(data.cell.raw);
                        if (val > 0) {
                            data.cell.styles.textColor = ROJO;
                            data.cell.styles.fontStyle = 'bold';
                        }
                    }
                },
                showHead: 'everyPage',
                didDrawPage: data => {
                    const pg = doc.getNumberOfPages();
                    drawFooter(pg, '—');
                    if (data.pageNumber > 1) drawHeader(subACP);
                }
            });
        }

        // ─────────────────────────────────────────
        // PAGINACIÓN FINAL (actualizar "de N")
        // ─────────────────────────────────────────
        const totalPg = doc.getNumberOfPages();
        for (let p = 1; p <= totalPg; p++) {
            doc.setPage(p);
            // Sobreescribir el número de página en el pie
            doc.setFillColor(...BLANCO);
            doc.rect(W - MARGIN - 28, H - 9, 28, 5, 'F');
            doc.setFontSize(6.5);
            doc.setTextColor(...GRIS_TXT);
            doc.text(`Página ${p} de ${totalPg}`, W - MARGIN, H - 6, { align: 'right' });
        }

        const nombreArchivo = `reporte_alertas_acp_${fechaCorta}.pdf`;
        doc.save(nombreArchivo);
        showToast('✅ Reporte generado: ' + nombreArchivo, '#003366');

    } catch (e) {
        console.error('[REPORTE] Error:', e);
        alert('Error al generar reporte: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📋 Generar Reporte PDF'; }
    }
}

window.gener