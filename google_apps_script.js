// =========================================================================================
// GOOGLE APPS SCRIPT v4.0 - HYBRID REAL-TIME + DASHBOARD SUPPORT
// =========================================================================================

// 1. DO GET: PARA EL TABLERO (LECTURA DE DOS HOJAS)
function doGet(e) {
    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();

        // Leer Registros (Hoja 1)
        var sheetRegistros = ss.getSheetByName("Registros") || ss.getSheets()[0];
        var dataRegistros = sheetRegistros.getDataRange().getValues();

        // Leer Incidencias ("Incidencias")
        var sheetIncidencias = ss.getSheetByName("Incidencias");
        var dataIncidencias = [];
        if (sheetIncidencias) {
            dataIncidencias = sheetIncidencias.getDataRange().getValues();
        }

        var response = {
            registros: dataRegistros,
            incidencias: dataIncidencias
        };

        return ContentService.createTextOutput(JSON.stringify(response))
            .setMimeType(ContentService.MimeType.JSON);
    } catch (e) {
        return ContentService.createTextOutput(JSON.stringify({ error: e.toString() }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

// 2. DO POST: PARA LA APP (ESCRITURA EN TIEMPO REAL)
function doPost(e) {
    var lock = LockService.getScriptLock();
    lock.tryLock(30000);

    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var data = JSON.parse(e.postData.contents);
        var action = data.action || 'full_upload';

        var sheetRegistros = ss.getSheetByName("Registros") || ss.getSheets()[0];
        var sheetIncidencias = getOrCreateSheet(ss, "Incidencias");

        // Indices clave para buscar y actualizar filas
        var headers = sheetRegistros.getRange(1, 1, 1, sheetRegistros.getLastColumn()).getValues()[0];
        var headerMap = {};
        for (var i = 0; i < headers.length; i++) {
            headerMap[headers[i].toString().toLowerCase().trim()] = i + 1;
        }

        function getColIndex(namesArray) {
            for (var name of namesArray) {
                var key = name.toLowerCase();
                if (headerMap[key]) return headerMap[key];
            }
            return -1;
        }

        var idxSession = getColIndex(["SessionID", "ID", "ID Supervision"]);
        var idxFin = getColIndex(["Fin", "Hora Fin"]);
        var idxDuracion = getColIndex(["Duracion", "Duración"]);
        var idxObs = getColIndex(["Observaciones", "Obs"]);

        // --- ACCIÓN: INICIO (O FULL UPLOAD VIEJO) ---
        if (action === 'start' || action === 'full_upload') {
            var mainFileUrl = "";
            if (data.mediaData) {
                mainFileUrl = saveToDrive(data.mediaData, data.mediaType, data.archivo);
            }

            // Creamos la fila inicial
            var newRow = [
                data.fecha,
                data.tipo_registro,
                data.turno,
                data.oficina,
                data.supervisor,
                data.nombre_protesta,
                data.categoria,
                data.punto,
                data.inicio,
                data.fin || "",
                data.lat_inicio,
                data.lng_inicio,
                data.lat_fin || "",
                data.lng_fin || "",
                data.duracion || "",
                data.fin_de_semana,
                mainFileUrl,
                data.observaciones,
                data.sessionId
            ];

            sheetRegistros.appendRow(newRow);
        }

        // --- ACCIÓN: NUEVA INCIDENCIA (TIEMPO REAL) ---
        else if (action === 'incident') {
            if (data.new_incident) {
                var inc = data.new_incident;
                var incUrl = "";
                if (inc.mediaData) incUrl = saveToDrive(inc.mediaData, inc.mediaType, inc.fileName);

                sheetIncidencias.appendRow([
                    data.sessionId,
                    data.fecha,
                    data.supervisor,
                    data.oficina,
                    inc.time,
                    inc.description,
                    incUrl
                ]);
            }
        }

        // --- ACCIÓN: FINALIZAR (SÓLO ACTUALIZA LA FILA) ---
        else if (action === 'finish') {
            if (idxSession > 0) {
                var rowIndex = findRowBySessionId(sheetRegistros, idxSession, data.sessionId);
                if (rowIndex > 0) {
                    if (idxFin > 0) sheetRegistros.getRange(rowIndex, idxFin).setValue(data.fin);
                    if (idxDuracion > 0) sheetRegistros.getRange(rowIndex, idxDuracion).setValue(data.duracion);
                    if (idxObs > 0 && data.observaciones) sheetRegistros.getRange(rowIndex, idxObs).setValue(data.observaciones);
                }
            }
        }

        return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);

    } catch (e) {
        return ContentService.createTextOutput("Error: " + e.toString()).setMimeType(ContentService.MimeType.TEXT);
    } finally {
        lock.releaseLock();
    }
}

// --- HELPERS ---
function findRowBySessionId(sheet, colIndex, sessionId) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return -1;
    var ids = sheet.getRange(2, colIndex, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
        if (ids[i][0] == sessionId) {
            return i + 2;
        }
    }
    return -1;
}

function getOrCreateSheet(ss, name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
        sheet = ss.insertSheet(name);
        sheet.appendRow(["ID Supervision", "Fecha", "Supervisor", "Oficina", "Hora Incidencia", "Descripción", "Foto Evidencia"]);
    }
    return sheet;
}

function saveToDrive(base64Data, mimeType, fileName) {
    try {
        if (!base64Data) return "";
        var decoded = Utilities.base64Decode(base64Data);
        var blob = Utilities.newBlob(decoded, mimeType, fileName);
        var folders = DriveApp.getFoldersByName("EVIDENCIA");
        var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder("EVIDENCIA");
        var file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        return file.getUrl();
    } catch (err) {
        return "Error: " + err.toString();
    }
}
