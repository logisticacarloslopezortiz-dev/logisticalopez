/**
 * Google Apps Script for TLC Transport Services
 * This script receives POST requests from the web application and saves data to Google Sheets
 * 
 * SETUP INSTRUCTIONS:
 * 1. Go to https://script.google.com/
 * 2. Create a new project
 * 3. Replace the default code with this script
 * 4. Create a new Google Sheet or use an existing one
 * 5. Update the SHEET_ID constant below with your Google Sheet ID
 * 6. Deploy as a web app with execute permissions set to "Anyone"
 * 7. Copy the web app URL and update it in google-sheets.js
 */

// ✅ SHEET ID REAL — Logística López Ortiz
const SHEET_ID = '1oVFJLmOaSQ-hz0DdqnHh_tCW5ON__jPM6GBqJQjIwGs';
const SHEET_NAME = 'TLC Orders';

// Supabase config para backup
const SUPABASE_URL = 'https://fkprllkxyjtosjhtikxy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZrcHJsbGt4eWp0b3NqaHRpa3h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3ODgzNzEsImV4cCI6MjA3NTM2NDM3MX0.FOcnxNujiA6gBzHQt9zLSRFCkOpiHDOu9QdLuEmbtqQ';

/**
 * Handle POST requests from the web application
 */
function doPost(e) {
  try {
    // Parse the incoming data
    const data = JSON.parse(e.postData.contents);
    
    // Log the received data for debugging
    console.log('Received data:', data);
    
    // Save to Google Sheets
    const result = saveToSheet(data);
    
    // Return success response
    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        message: 'Data saved successfully',
        rowNumber: result.rowNumber
      }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    console.error('Error processing request:', error);
    
    // Return error response
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        message: 'Error saving data: ' + error.toString()
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handle GET requests (for testing)
 */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      message: 'TLC Transport Services - Google Sheets Integration Active',
      timestamp: new Date().toISOString()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Save order data to Google Sheets
 */
function saveToSheet(data) {
  try {
    // Open the spreadsheet
    const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
    
    // Get or create the sheet
    let sheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(SHEET_NAME);
      // Add headers if it's a new sheet
      addHeaders(sheet);
    }
    
    // Prepare the row data
    const rowData = [
      data.orderId || '',
      data.orderType || '',
      data.timestamp || '',
      data.clientName || '',
      data.clientPhone || '',
      data.clientEmail || '',
      data.rncNumber || '',
      data.companyName || '',
      data.service || '',
      data.vehicle || '',
      data.serviceDescription || '',
      data.serviceDetails || '',
      data.pickupAddress || '',
      data.deliveryAddress || '',
      data.serviceDate || '',
      data.serviceTime || '',
      data.status || '',
      data.createdAt || ''
    ];
    
    // Add the data to the sheet
    const lastRow = sheet.getLastRow();
    const newRow = lastRow + 1;
    
    // Insert the data
    sheet.getRange(newRow, 1, 1, rowData.length).setValues([rowData]);
    
    // Auto-resize columns for better readability
    sheet.autoResizeColumns(1, rowData.length);
    
    console.log(`Data saved to row ${newRow}`);
    
    return {
      success: true,
      rowNumber: newRow
    };
    
  } catch (error) {
    console.error('Error saving to sheet:', error);
    throw error;
  }
}

/**
 * Add headers to a new sheet
 */
function addHeaders(sheet) {
  const headers = [
    'ID de Orden',
    'Tipo de Orden',
    'Fecha y Hora',
    'Nombre del Cliente',
    'Teléfono',
    'Email',
    'RNC',
    'Nombre de Empresa',
    'Servicio',
    'Vehículo',
    'Descripción del Servicio',
    'Detalles Específicos',
    'Dirección de Recogida',
    'Dirección de Entrega',
    'Fecha del Servicio',
    'Hora del Servicio',
    'Estado',
    'Creado en'
  ];
  
  // Set headers
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  // Format headers
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#4285f4');
  headerRange.setFontColor('white');
  
  // Freeze the header row
  sheet.setFrozenRows(1);
  
  console.log('Headers added to new sheet');
}

/**
 * Test function to verify the setup
 */
function testSetup() {
  try {
    const testData = {
      orderId: 'TEST-001',
      orderType: 'TEST ORDER',
      timestamp: new Date().toLocaleString('es-DO'),
      clientName: 'Test Client',
      clientPhone: '+1-809-555-0123',
      clientEmail: 'test@example.com',
      service: 'Test Service',
      vehicle: 'Test Vehicle',
      status: 'Test',
      createdAt: new Date().toISOString()
    };
    
    const result = saveToSheet(testData);
    console.log('Test successful:', result);
    return result;
    
  } catch (error) {
    console.error('Test failed:', error);
    throw error;
  }
}

/**
 * Get all orders from the sheet (for admin panel integration)
 */
function getAllOrders() {
  try {
    const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
    const sheet = spreadsheet.getSheetByName(SHEET_NAME);
    
    if (!sheet) {
      return [];
    }
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const rows = data.slice(1);
    
    // Convert to objects
    const orders = rows.map(row => {
      const order = {};
      headers.forEach((header, index) => {
        order[header] = row[index];
      });
      return order;
    });
    
    return orders;
    
  } catch (error) {
    console.error('Error getting orders:', error);
    return [];
  }
}

/**
 * Update order status
 */
function updateOrderStatus(orderId, newStatus) {
  try {
    const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
    const sheet = spreadsheet.getSheetByName(SHEET_NAME);
    
    if (!sheet) {
      throw new Error('Sheet not found');
    }
    
    const data = sheet.getDataRange().getValues();
    
    // Find the order row
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === orderId) { // Assuming order ID is in column A
        sheet.getRange(i + 1, 17).setValue(newStatus); // Status is in column Q (17)
        console.log(`Order ${orderId} status updated to ${newStatus}`);
        return true;
      }
    }
    
    throw new Error('Order not found');
    
  } catch (error) {
    console.error('Error updating order status:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// BACKUP AUTOMÁTICO SUPABASE → GOOGLE SHEETS
// Configura un trigger en Apps Script: backupOrdersFromSupabase
// cada 24 horas (Time-driven → Day timer)
// ═══════════════════════════════════════════════════════════════

/**
 * Backup completo de órdenes desde Supabase.
 * Ejecutar manualmente o via trigger diario.
 */
function backupOrdersFromSupabase() {
  try {
    const response = UrlFetchApp.fetch(
      SUPABASE_URL + '/rest/v1/orders?select=id,short_id,name,phone,email,status,pickup,delivery,date,time,monto_cobrado,metodo_pago,created_at&order=created_at.desc&limit=1000',
      {
        method: 'get',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json'
        },
        muteHttpExceptions: true
      }
    );

    if (response.getResponseCode() !== 200) {
      Logger.log('Error Supabase: ' + response.getContentText());
      return;
    }

    const data = JSON.parse(response.getContentText());
    if (!data || data.length === 0) { Logger.log('Sin datos para backup'); return; }

    const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
    let sheet = spreadsheet.getSheetByName('Backup Órdenes');
    if (!sheet) sheet = spreadsheet.insertSheet('Backup Órdenes');

    sheet.clear();
    const headers = Object.keys(data[0]);
    const rows = data.map(obj => headers.map(h => obj[h] !== null && obj[h] !== undefined ? String(obj[h]) : ''));
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (rows.length > 0) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

    // Formato de cabecera
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');

    Logger.log('✅ Backup completado: ' + rows.length + ' órdenes — ' + new Date().toISOString());
  } catch (error) {
    Logger.log('❌ Error en backup: ' + error);
  }
}

/**
 * Backup incremental — solo órdenes nuevas desde la última ejecución.
 * Más eficiente para uso diario.
 */
function backupIncrementalOrders() {
  try {
    const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
    let sheet = spreadsheet.getSheetByName('Backup Incremental');
    if (!sheet) {
      sheet = spreadsheet.insertSheet('Backup Incremental');
      sheet.appendRow(['id','short_id','name','phone','status','monto_cobrado','created_at']);
    }

    // Obtener la fecha del último registro
    const lastRow = sheet.getLastRow();
    let lastDate = '2020-01-01T00:00:00Z';
    if (lastRow > 1) {
      const lastVal = sheet.getRange(lastRow, 7).getValue();
      if (lastVal) lastDate = new Date(lastVal).toISOString();
    }

    const response = UrlFetchApp.fetch(
      SUPABASE_URL + '/rest/v1/orders?select=id,short_id,name,phone,status,monto_cobrado,created_at&created_at=gt.' + lastDate + '&order=created_at.asc',
      {
        method: 'get',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
        muteHttpExceptions: true
      }
    );

    const data = JSON.parse(response.getContentText());
    if (!data || data.length === 0) { Logger.log('Sin nuevas órdenes'); return; }

    const rows = data.map(o => [o.id, o.short_id, o.name, o.phone, o.status, o.monto_cobrado, o.created_at]);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 7).setValues(rows);
    Logger.log('✅ Incremental: ' + rows.length + ' nuevas órdenes agregadas');
  } catch (error) {
    Logger.log('❌ Error incremental: ' + error);
  }
}

/**
 * Recibe webhook en tiempo real desde Supabase Edge Function.
 * Cada nueva orden se guarda automáticamente.
 * URL del Web App → configurar en Supabase como webhook destino.
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // Si es un webhook de nueva orden
    if (data.type === 'INSERT' && data.table === 'orders') {
      const order = data.record;
      const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
      let sheet = spreadsheet.getSheetByName('Tiempo Real');
      if (!sheet) {
        sheet = spreadsheet.insertSheet('Tiempo Real');
        sheet.appendRow(['ID','Short ID','Cliente','Teléfono','Servicio','Estado','Monto','Fecha']);
        sheet.getRange(1,1,1,8).setBackground('#1e293b').setFontColor('#fff').setFontWeight('bold');
      }
      sheet.appendRow([
        order.id, order.short_id, order.name, order.phone,
        order.service_id, order.status, order.monto_cobrado, order.created_at
      ]);
      return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(ContentService.MimeType.JSON);
    }

    // Flujo original de la app
    const result = saveToSheet(data);
    return ContentService.createTextOutput(JSON.stringify({ success: true, rowNumber: result.rowNumber })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}
