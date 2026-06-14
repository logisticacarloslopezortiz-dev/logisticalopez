$htmlPath = "c:\Users\usuario\Documents\tlc\panel-colaborador.html"
$content = Get-Content -Path $htmlPath -Raw

# Find the start and end of the right column
$startMarker = '      <!-- Columna derecha: información adicional -->'
$endMarker = '      </div>'

# Find the start index
$startIndex = $content.IndexOf($startMarker)
if ($startIndex -ne -1) {
    # Find the closing </div> after the start marker. Let's find the position after the right column.
    # The right column ends before "    </div>" (the closing of active-job-grid)
    $gridEndMarker = '    </div>'
    $gridEndIndex = $content.IndexOf($gridEndMarker, $startIndex)
    
    # Now, let's get the substring from startIndex to gridEndIndex
    $rightColumnContent = $content.Substring($startIndex, $gridEndIndex - $startIndex)
    Write-Host "Removing right column..."
    $content = $content.Remove($startIndex, $gridEndIndex - $startIndex)
}

Set-Content -Path $htmlPath -Value $content -NoNewline

Write-Host "HTML file updated successfully!"
