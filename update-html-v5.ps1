$htmlPath = "c:\Users\usuario\Documents\tlc\panel-colaborador.html"
$lines = Get-Content -Path $htmlPath
$filteredLines = @()
$skip = $false

foreach ($line in $lines) {
    if ($line -match '<!-- Columna derecha: información adicional -->') {
        $skip = $true
        continue
    }
    if ($skip -and $line -match '      </div>') {
        $skip = $false
        continue
    }
    if (-not $skip) {
        $filteredLines += $line
    }
}

$filteredLines | Set-Content -Path $htmlPath -NoNewline

Write-Host "HTML file updated successfully!"
