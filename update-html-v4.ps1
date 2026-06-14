$htmlPath = "c:\Users\usuario\Documents\tlc\panel-colaborador.html"
$content = Get-Content -Path $htmlPath -Raw

# We need to keep the left column and remove everything after it until the closing </div> of active-job-grid
# The left column ends with:
#        </div>
#
#      </div>

# Let's find the end of the left column
$leftColumnEnd = '        </div>

      </div>'

# Then find the closing of the grid: '    </div>'
# We'll replace everything between $leftColumnEnd and '    </div>' (excluding) with nothing
# Wait, let's use a regex that matches from after the left column to the end of the grid
$pattern = '(?s)(?<=        </div>\s+      </div>).*?(?=    </div>)'
$content = [regex]::Replace($content, $pattern, '')

Set-Content -Path $htmlPath -Value $content -NoNewline

Write-Host "HTML file updated successfully!"
