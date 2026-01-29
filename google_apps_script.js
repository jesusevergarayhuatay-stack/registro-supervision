function doPost(e) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);

    sheet.appendRow([
        data.fecha,
        data.oficina,
        data.supervisor,
        data.categoria,
        data.punto,
        data.inicio,
        data.fin,
        data.duracion,
        data.fin_de_semana,
        data.observaciones
    ]);

    return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);
}
