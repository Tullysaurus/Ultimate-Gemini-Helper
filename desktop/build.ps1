# Builds UGH Desktop with PyInstaller.
#
# Usage (from anywhere):
#   powershell -ExecutionPolicy Bypass -File desktop\build.ps1          # dist\UGH.exe (single file, to share)
#   powershell -ExecutionPolicy Bypass -File desktop\build.ps1 -Fast    # dist\UGH\UGH.exe (folder, quick to build and start)
#   ... -Clean                                                          # ignore PyInstaller's cache (if a build acts up)
#   ... -Reinstall                                                      # reinstall packages even if requirements.txt is unchanged
#
# For day-to-day testing you don't need a build at all:  .\.venv\Scripts\python.exe main.py
param(
    [switch]$Fast,
    [switch]$Clean,
    [switch]$Reinstall
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$started = Get-Date

# --- Python environment (packages are only reinstalled when requirements.txt changes) ---
if (-not (Test-Path ".venv")) {
    python -m venv .venv
    if ($LASTEXITCODE) { throw "Couldn't create the virtual environment (is Python on PATH?)" }
}
$py = (Resolve-Path ".\.venv\Scripts\python.exe").Path
$stamp = ".venv\.ugh-requirements.sha256"
$reqHash = (Get-FileHash requirements.txt -Algorithm SHA256).Hash
$installed = if (Test-Path $stamp) { (Get-Content $stamp -Raw).Trim() } else { "" }
if ($Reinstall -or $installed -ne $reqHash) {
    Write-Host "Installing packages..."
    & $py -m pip install --upgrade pip
    & $py -m pip install -r requirements.txt pyinstaller
    if ($LASTEXITCODE) { throw "pip install failed" }
    Set-Content $stamp $reqHash
} else {
    Write-Host "Packages up to date (requirements.txt unchanged)."
}

# --- Icon: rendered from the same SVG the app uses for its tray icon (only once) ---
New-Item -ItemType Directory -Force build | Out-Null
$icon = Join-Path $PSScriptRoot "build\ugh.ico"
if (-not (Test-Path $icon)) {
    & $py -c "from PyQt6.QtWidgets import QApplication; app = QApplication([]); from ugh_desktop.icons import app_pixmap; assert app_pixmap(256).save('build/ugh.ico', 'ICO')"
    if ($LASTEXITCODE) { throw "Icon generation failed" }
}

# --- A running copy of the exe being rebuilt locks its files and would make the build fail ---
$out = if ($Fast) { "$PSScriptRoot\dist\UGH\UGH.exe" } else { "$PSScriptRoot\dist\UGH.exe" }
$locked = Get-Process UGH -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -eq $out) }
if ($locked) {
    throw "$out is running. Quit it from the tray icon first, then build again."
}

# --- PyInstaller ---
# Things the app never uses. matplotlib is only used to draw formulas as PNGs
# (Agg backend), so its GUI backends and their toolkits can go.
$excludes = @(
    "tkinter", "_tkinter", "PIL.ImageTk",
    "matplotlib.backends.backend_tkagg", "matplotlib.backends.backend_tkcairo", "matplotlib.backends._backend_tk",
    "matplotlib.backends.backend_qtagg", "matplotlib.backends.backend_qtcairo", "matplotlib.backends.backend_qt",
    "matplotlib.backends.backend_wx", "matplotlib.backends.backend_wxagg", "matplotlib.backends.backend_wxcairo",
    "matplotlib.backends.backend_gtk3", "matplotlib.backends.backend_gtk3agg", "matplotlib.backends.backend_gtk3cairo",
    "matplotlib.backends.backend_gtk4", "matplotlib.backends.backend_gtk4agg", "matplotlib.backends.backend_gtk4cairo",
    "matplotlib.backends.backend_webagg", "matplotlib.backends.backend_webagg_core", "matplotlib.backends.backend_nbagg",
    "matplotlib.backends.backend_macosx", "matplotlib.backends.backend_pgf", "matplotlib.backends.backend_template",
    "IPython", "jupyter_client", "ipykernel", "pytest", "setuptools", "pydoc_data",
    # PyInstaller always excludes __main__, but adds it by modifying our list in place, so the cached
    # list never matches the next build's and the cache is thrown away. Listing it ourselves avoids that.
    "__main__"
)

$mode = if ($Fast) { "fast" } else { "release" }
$pyiArgs = @(
    "-m", "PyInstaller", "--noconfirm", "--windowed",
    "--name", "UGH",
    "--icon", $icon,
    "--hidden-import", "keyring.backends.Windows",
    "--workpath", (Join-Path $PSScriptRoot "build\$mode"),   # separate caches, so switching modes doesn't rebuild everything
    "--specpath", (Join-Path $PSScriptRoot "build"),
    "--distpath", (Join-Path $PSScriptRoot "dist")
)
if ($Fast) { $pyiArgs += "--onedir" } else { $pyiArgs += "--onefile" }
if ($Clean) { $pyiArgs += "--clean" }
foreach ($m in $excludes) { $pyiArgs += @("--exclude-module", $m) }
$pyiArgs += "main.py"

& $py @pyiArgs
if ($LASTEXITCODE) { throw "PyInstaller failed" }

$secs = [math]::Round(((Get-Date) - $started).TotalSeconds)
Write-Host ""
Write-Host "Built ($mode, ${secs}s): $out"
