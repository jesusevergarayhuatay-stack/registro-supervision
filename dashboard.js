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

function renderDashboard() {
    const selectedDate = filterDate.value; // YYYY-MM-DD
    const selectedRegion = filterRegion.value;
    const selectedProtest = filterProtest.value;

    // Filtrar
    const filtered = allData.filter(item => {
        // Normalizar fecha
        let itemDateStr = item.fecha;
        if (itemDateStr && itemDateStr.includes('T')) itemDateStr = itemDateStr.split('T')[0];

        const dateMatch = !selectedDate || itemDateStr === selectedDate;
        const regionMatch = !selectedRegion || item.tipo_registro === selectedRegion;
        const protestMatch = !selectedProtest || item.nombre_protesta === selectedProtest;

        return dateMatch && regionMatch && protestMatch;
    });

    // Actualizar Estadísticas
    updateStats(filtered);

    // Renderizar Lista
    reportsList.innerHTML = '';
    if (filtered.length === 0) {
        reportsList.innerHTML = '<div class="empty-msg">No se encontraron reportes para este filtro.</div>';
        return;
    }

    filtered.forEach(item => {
        const card = document.createElement('div');
        card.className = 'report-card';

        // Parsear incidencias
        let incidentsArray = [];
        if (Array.isArray(item.incidencias)) {
            incidentsArray = item.incidencias;
        } else if (typeof item.incidencias === 'string' && item.incidencias.startsWith('[')) {
            try { incidentsArray = JSON.parse(item.incidencias); } catch (e) { }
        }

        const incidentCount = incidentsArray.length;
        const hasIncidents = incidentCount > 0;

        // Construir HTML de las incidencias
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

        // Observación general
        const obsHtml = item.observaciones
            ? `<p style="margin-top:10px; font-style:italic; color:#444; background:#f8fafc; padding:8px; border-radius:6px;">"${item.observaciones}"</p>`
            : '';

        card.innerHTML = `
            <div>
                <h3>${item.punto} <span style="font-weight:400; color:#666;">(${item.oficina})</span></h3>
                <div class="report-meta">
                    <span>👤 ${item.supervisor}</span>
                    <span>🕒 ${item.inicio} - ${item.fin}</span>
                    <span>${item.categoria}</span>
                </div>
                ${item.nombre_protesta ? `<div style="margin-top:5px; font-weight:500;">🚩 ${item.nombre_protesta}</div>` : ''}
                
                ${obsHtml}
                ${incidentsHtml}
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:10px;">
                ${statusBadge}
                ${item.archivo ? `<a href="#" style="font-size:0.9rem;">📷 Foto General</a>` : ''}
            </div>
        `;
        reportsList.appendChild(card);
    });
}

function updateStats(data) {
    statTotal.textContent = data.length;

    const uniqueSupervisors = new Set(data.map(d => d.supervisor)).size;
    statSupervisors.textContent = uniqueSupervisors;

    let totalIncidents = 0;
    data.forEach(d => {
        if (Array.isArray(d.incidencias)) totalIncidents += d.incidencias.length;
        else if (typeof d.incidencias === 'string' && d.incidencias.startsWith('[')) {
            try { totalIncidents += JSON.parse(d.incidencias).length; } catch (e) { }
        }
    });
    statIncidents.textContent = totalIncidents;
}
