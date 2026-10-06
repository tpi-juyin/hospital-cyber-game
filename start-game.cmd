@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "runtime\node.exe" (
  "runtime\node.exe" scripts\launch.mjs %*
) else (
  node scripts\launch.mjs %*
)
if errorlevel 1 (
  echo 啟動未完成，請查看上方訊息。按任意鍵關閉。
  pause >nul
)
