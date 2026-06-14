$htmlPath = "c:\Users\usuario\Documents\tlc\panel-colaborador.html"
$content = Get-Content -Path $htmlPath -Raw

# Use regex to remove the right column from <!-- Columna derecha: información adicional --> to </div> before the closing </div> of active-job-grid
$pattern = '(?s)      <!-- Columna derecha: información adicional -->.*?      </div>\s*?(?=    </div>)'
$content = [regex]::Replace($content, $pattern, '')

Set-Content -Path $htmlPath -Value $content -NoNewline

Write-Host "HTML file updated successfully!"
