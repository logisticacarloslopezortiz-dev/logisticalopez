$htmlPath = "c:\Users\usuario\Documents\tlc\panel-colaborador.html"
$content = Get-Content -Path $htmlPath -Raw

# Remove capture="environment" from file input
$content = $content -replace 'capture="environment"', ''

# Remove the right column (Estado del Servicio and Historial)
# Find the start of the right column
$rightColumnStart = '      <!-- Columna derecha: información adicional -->'
$rightColumnEnd = '      </div>'

# Find the indices
$startIndex = $content.IndexOf($rightColumnStart)
if ($startIndex -ne -1) {
    # Find the closing div that matches
    $endIndex = $content.IndexOf($rightColumnEnd, $startIndex) + $rightColumnEnd.Length
    $content = $content.Remove($startIndex, $endIndex - $startIndex)
}

Set-Content -Path $htmlPath -Value $content -NoNewline

Write-Host "HTML file updated successfully!"
