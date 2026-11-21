# Draft Assistant — встановлення одним рядком (PowerShell):
#   irm https://raw.githubusercontent.com/plton228/dota-draft-assistant/main/docs/install.ps1 | iex
# Бере найновіший реліз з GitHub (DraftAssistant-win64.zip — програма на підписаному Python), розпаковує в
# %LOCALAPPDATA%\DraftAssistant, створює ярлики на робочому столі й у меню «Пуск» і запускає програму.
# Уже встановлено — нічого не перезаписує (там ваші дані й налаштування): просто запускає, далі програма
# оновлюється сама. Налаштувань захисту Windows скрипт не чіпає.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # без смуги прогресу Invoke-WebRequest завантажує в рази швидше
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$repo = 'plton228/dota-draft-assistant'
$asset = 'DraftAssistant-win64.zip'
$root = if ($env:DA_INSTALL_ROOT) { $env:DA_INSTALL_ROOT } else { $env:LOCALAPPDATA }
$dest = Join-Path $root 'DraftAssistant'
$exe = Join-Path $dest 'DraftAssistant.exe'

function New-DaShortcut([string]$path) {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($path)
    $link.TargetPath = $exe
    $link.WorkingDirectory = $dest
    $link.Description = 'Draft Assistant'
    $link.Save()
}

if (Test-Path $exe) {
    Write-Host "Draft Assistant вже встановлено: $dest" -ForegroundColor Green
    Write-Host 'Запускаю — нові версії програма завантажує сама.'
} else {
    Write-Host 'Draft Assistant: шукаю найновішу версію...' -ForegroundColor Cyan
    $release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'DraftAssistant-installer' }
    $url = ($release.assets | Where-Object { $_.name -eq $asset }).browser_download_url
    if (-not $url) { throw "У релізі $($release.tag_name) немає файла $asset" }
    $zip = Join-Path $env:TEMP ("DraftAssistant-" + [guid]::NewGuid().ToString('N') + '.zip')
    Write-Host "Завантажую $($release.tag_name) (~110 МБ)..."
    Invoke-WebRequest $url -OutFile $zip -UseBasicParsing
    try {
        Write-Host "Розпаковую в $dest ..."
        New-Item -ItemType Directory -Force -Path $root | Out-Null
        Expand-Archive -Path $zip -DestinationPath $root -Force  # в архіві — тека DraftAssistant
    } finally {
        Remove-Item $zip -Force -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path $exe)) { throw "Після розпакування немає $exe" }
    New-DaShortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Draft Assistant.lnk')
    New-DaShortcut (Join-Path ([Environment]::GetFolderPath('Programs')) 'Draft Assistant.lnk')
    Write-Host "Готово: $($release.tag_name) у $dest, ярлики — на робочому столі й у меню «Пуск»." -ForegroundColor Green
}

if (-not $env:DA_NO_START) { Start-Process -FilePath $exe -WorkingDirectory $dest }
