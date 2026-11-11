# Builds dist\UGH.exe (single file, no console window) with PyInstaller.
# Usage (from this folder):  powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".venv")) {
    python -m venv .venv
}
$py = ".\.venv\Scripts\python.exe"
& $py -m pip install --upgrade pip
& $py -m pip install -r requirements.txt pyinstaller

# Icon: rendered from the same SVG the app uses for its tray icon.
New-Item -ItemType Directory -Force build | Out-Null
& $py -c "from PyQt6.QtWidgets import QApplication; app = QApplication([]); from ugh_desktop.icons import app_pixmap; assert app_pixmap(256).save('build/ugh.ico', 'ICO')"

& $py -m PyInstaller --noconfirm --clean --onefile --windowed `
    --name UGH `
    --icon build\ugh.ico `
    --hidden-import keyring.backends.Windows `
    main.py

Write-Host ""
Write-Host "Built: $PSScriptRoot\dist\UGH.exe"
