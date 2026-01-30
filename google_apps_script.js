function doPost(e) {
    try {
        var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
        var data = JSON.parse(e.postData.contents);

        var fileUrl = "";

        // Procesar Archivo si existe
        if (data.mediaData && data.mediaData.length > 0) {
            try {
                // Decodificar Base64
                var decoded = Utilities.base64Decode(data.mediaData);
                var blob = Utilities.newBlob(decoded, data.mediaType, data.archivo);

                // Guardar en Drive (Raíz o carpeta específica si se prefiere)
                // Para organizar mejor, se podría buscar/crear una carpeta "Evidencias_Supervision"
                // var folder = DriveApp.getFoldersByName("Evidencias_Supervision").next();
                var file = DriveApp.createFile(blob);
                file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
                fileUrl = file.getUrl();
            } catch (err) {
                fileUrl = "Error subiendo archivo: " + err.toString();
            }
        } else {
            // Si no hay data real pero hay nombre, mantenemos el nombre (caso video)
            if (data.archivo) fileUrl = "(Solo nombre) " + data.archivo;
        }

        sheet.appendRow([
            data.fecha,
            data.tipo_registro,
            data.turno,
            data.oficina,
            data.supervisor,
            data.nombre_protesta,
            data.categoria,
            data.punto,
            data.inicio,
            data.fin,
            data.lat_inicio,
            data.lng_inicio,
            data.lat_fin,
            data.lng_fin,
            data.duracion,
            data.fin_de_semana,
            fileUrl, // Aquí va la URL ahora
            data.observaciones
        ]);

        return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);
    } catch (e) {
        return ContentService.createTextOutput("Error: " + e.toString()).setMimeType(ContentService.MimeType.TEXT);
    }
}
