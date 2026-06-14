$jsPath = "c:\Users\usuario\Documents\tlc\js\panel-colaborador.js"
$content = Get-Content -Path $jsPath -Raw

# First, fix the activeJobDelivery to activeJobDropoff
$content = $content -replace 'activeJobDelivery', 'activeJobDropoff'

# Now update the btnVerOrigen and btnVerDestino listeners
$oldBtnCode = @"
  if (btnVerOrigen) btnVerOrigen.addEventListener('click', () => {
    if (currentOrder?.pickup) openGoogleMaps(currentOrder.pickup);
  });
  if (btnVerDestino) btnVerDestino.addEventListener('click', () => {
    if (currentOrder?.delivery) openGoogleMaps(currentOrder.delivery);
  });
"@

$newBtnCode = @"
  if (btnVerOrigen) btnVerOrigen.addEventListener('click', () => {
    if (currentOrder) {
      const oc = currentOrder.origin_coords;
      if (oc && typeof oc.lat === 'number' && typeof oc.lng === 'number') {
        const url = `https://www.google.com/maps/search/?api=1&query=${oc.lat},${oc.lng}`;
        window.open(url, '_blank');
      } else if (currentOrder.pickup) {
        openGoogleMaps(currentOrder.pickup);
      }
    }
  });
  if (btnVerDestino) btnVerDestino.addEventListener('click', () => {
    if (currentOrder) {
      const dc = currentOrder.destination_coords;
      if (dc && typeof dc.lat === 'number' && typeof dc.lng === 'number') {
        const url = `https://www.google.com/maps/search/?api=1&query=${dc.lat},${dc.lng}`;
        window.open(url, '_blank');
      } else if (currentOrder.delivery) {
        openGoogleMaps(currentOrder.delivery);
      }
    }
  });
"@

$content = $content.Replace($oldBtnCode, $newBtnCode)
Set-Content -Path $jsPath -Value $content -NoNewline

Write-Host "JS file updated successfully!"
