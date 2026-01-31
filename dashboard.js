// Configuración
const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbyMdFTSPAMCDKDB8wMQStC_AwC5KPSm9fId3OGFAi9pcgWVRugVUdUS3GaC00rpjfY-Ig/exec";

// Elementos
const filterDate = document.getElementById('filter-date');
const filterProtest = document.getElementById('filter-protest');
const filterRegion = document.getElementById('filter-region');
const refreshBtn = document.getElementById('refresh-btn');
const reportsList = document.getElementById('reports-list');
const loadingIndicator = document.getElementById('loading');
const statTotal = document.getElementById('stat-total');
const statSupervisors = document.getElementById('stat-supervisors');
const statIncidents = document.getElementById('stat-incidents');

let allData = [];

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    // Set fecha de hoy por defecto
    const today = new Date().toISOString().split('T')[0];
    filterDate.value = today;

    fetchData();
});

refreshBtn.addEventListener('click', fetchData);
filterDate.addEventListener('change', renderDashboard);
filterRegion.addEventListener('change', renderDashboard);
filterProtest.addEventListener('change', renderDashboard);

async function fetchData() {
    loadingIndicator.style.display = 'block';
    reportsList.innerHTML = '';

    try {
        const response = await fetch(GOOGLE_SHEETS_URL);
        const json = await response.json();

        if (json.status === 'success') {
            allData = json.data;
            populateProtestFilter(allData);
            renderDashboard();
        } else {
            reportsList.innerHTML = `<div class="empty-msg">Error: ${json.message}</div>`;
        }
    } catch (error) {
        console.error("Error fetching data:", error);
        reportsList.innerHTML = `
            <div class="empty-msg" style="color: var(--danger);">
                Error de conexión. Asegúrate de haber actualizado el código en Google Apps Script para permitir 'doGet'.
            </div>`;
    } finally {
        loadingIndicator.style.display = 'none';
    }
}

function populateProtestFilter(data) {
    const protests = new Set();
    data.forEach(item => {
        if (item.nombre_protesta) protests.add(item.nombre_protesta);
    });

    const currentVal = filterProtest.value;
    filterProtest.innerHTML = '<option value="">Todas las protestas</option>';

    protests.forEach(p => {
        const option = document.createElement('option');
        option.value = p;
        option.textContent = p;
        filterProtest.appendChild(option);
    });

    filterProtest.value = currentVal;
}

// Helper para buscar propiedades de forma flexible (case insensitive, variaciones)
function getProp(item, keys) {
    for (let key of keys) {
        // Búsqueda directa
        if (item[key] !== undefined) return item[key];
        // Búsqueda normalizada
        const keyNorm = key.toLowerCase().replace(/ /g, '_');
        if (item[keyNorm] !== undefined) return item[keyNorm];
    }
    return ""; // Si no encuentra, retorna vacío para no mostrar "undefined"
}

function renderDashboard() {
    const selectedDate = filterDate.value;
    const selectedRegion = filterRegion.value;
    const selectedProtest = filterProtest.value;

    const filtered = allData.filter(item => {
        // Obtener fecha de forma segura
        let rawDate = getProp(item, ['fecha', 'Date', 'Fecha']);
        if (!rawDate) return false;

        let itemDateStr = rawDate;
        if (typeof rawDate === 'string' && rawDate.includes('T')) {
            itemDateStr = rawDate.split('T')[0];
        }

        const type = getProp(item, ['tipo_registro', 'Tipo', 'Tipo Registro']);
        const protest = getProp(item, ['nombre_protesta', 'Protesta', 'Nombre Protesta']);

        const dateMatch = !selectedDate || itemDateStr === selectedDate;
        const regionMatch = !selectedRegion || type === selectedRegion;
        const protestMatch = !selectedProtest || protest === selectedProtest;

        return dateMatch && regionMatch && protestMatch;
    });

    updateStats(filtered);

    reportsList.innerHTML = '';
    if (filtered.length === 0) {
        reportsList.innerHTML = '<div class="empty-msg">No se encontraron reportes para este filtro.</div>';
        return;
    }

    filtered.forEach(item => {
        const card = document.createElement('div');
        card.className = 'report-card';

        // Obtener datos usando el Helper
        const punto = getProp(item, ['punto', 'Punto de Supervisión', 'Ubicación', 'Lugar', 'punto_/_ubicación', 'punto_ubicación']) || "Punto no especificado";
        const oficina = getProp(item, ['oficina', 'Oficina', 'Sede']);
        const supervisor = getProp(item, ['supervisor', 'Nombre Supervisor', 'Responsable', 'Nombre Comisionado']);
        const inicio = getProp(item, ['inicio', 'Hora Inicio', 'Start']);
        const fin = getProp(item, ['fin', 'Hora Fin', 'End']) || "En curso";
        const categoria = getProp(item, ['categoria', 'Categoria']);
        const nombreProtesta = getProp(item, ['nombre_protesta', 'Protesta']);
        const obs = getProp(item, ['observaciones', 'Observaciones', 'Obs']);
        const archivo = getProp(item, ['archivo', 'Foto Principal', 'Media', 'archivo_/_foto']);

        // Incidencias
        let rawIncidents = getProp(item, ['incidencias', 'Incidencias JSON', 'Incidencias', 'incidencias_json']);
        let incidentsArray = [];
        if (Array.isArray(rawIncidents)) {
            incidentsArray = rawIncidents;
        } else if (typeof rawIncidents === 'string' && rawIncidents.startsWith('[')) {
            try { incidentsArray = JSON.parse(rawIncidents); } catch (e) { }
        }

        const incidentCount = incidentsArray.length;
        const hasIncidents = incidentCount > 0;

        let incidentsHtml = '';
        if (hasIncidents) {
            incidentsHtml = `<div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee;">
                <h4 style="font-size: 0.9rem; color: #e67e22; margin-bottom: 8px;">🔥 Incidencias Reportadas:</h4>
                ${incidentsArray.map(inc => `
                    <div style="background: #fff8f0; padding: 8px; border-radius: 6px; margin-bottom: 6px; font-size: 0.9rem;">
                        <strong>${inc.time || ''}</strong>: ${inc.description}
                        ${inc.fileName ? `<br><span style="font-size:0.8rem; color:#666;">📎 ${inc.fileName}</span>` : ''}
                    </div>
                `).join('')}
            </div>`;
        }

        const statusBadge = hasIncidents
            ? `<span class="badge" style="background: #e67e22;">${incidentCount} Incidencias</span>`
            : `<span class="badge" style="background: #16a34a;">Sin Novedad</span>`;

        const obsHtml = obs
            ? `<p style="margin-top:10px; font-style:italic; color:#444; background:#f8fafc; padding:8px; border-radius:6px;">"${obs}"</p>`
            : '';

        card.innerHTML = `
            <div>
                <h3>${punto} <span style="font-weight:400; color:#666;">(${oficina})</span></h3>
                <div class="report-meta">
                    <span>👤 ${supervisor}</span>
                    <span>🕒 ${inicio} - ${fin}</span>
                    <span>${categoria}</span>
                </div>
                ${nombreProtesta ? `<div style="margin-top:5px; font-weight:500;">🚩 ${nombreProtesta}</div>` : ''}
                
                ${obsHtml}
                ${incidentsHtml}
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:10px;">
                ${statusBadge}
                ${archivo ? `<a href="#" style="font-size:0.9rem;">📷 Foto General</a>` : ''}
            </div>
        `;
        reportsList.appendChild(card);
    });
}

function updateStats(data) {
    statTotal.textContent = data.length;

    const uniqueSupervisors = new Set(data.map(d => getProp(d, ['supervisor', 'Nombre Comisionado']))).size;
    statSupervisors.textContent = uniqueSupervisors;

    let totalIncidents = 0;
    data.forEach(d => {
        let rawIncidents = getProp(d, ['incidencias', 'Incidencias JSON', 'incidencias_json']);
        if (Array.isArray(rawIncidents)) totalIncidents += rawIncidents.length;
        else if (typeof rawIncidents === 'string' && rawIncidents.startsWith('[')) {
            try { totalIncidents += JSON.parse(rawIncidents).length; } catch (e) { }
        }
    });
    statIncidents.textContent = totalIncidents;
}
