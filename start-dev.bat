@echo off
title OpenMausBot Local Dev
echo Starting OpenMausBot Harness Server and Web UI...

set NODE_PATH=C:\Users\123\AppData\Roaming\fnm\node-versions\v24.22.2\installation
set PATH=%NODE_PATH%;%PATH%

start "OpenMausBot Server (8799)" cmd /k "node --experimental-strip-types server/dev-server.ts"
timeout /t 3 >nul
start "OpenMausBot UI (5199)" cmd /k "pnpm dev"

echo Done! Open your browser at: http://127.0.0.1:5199/
pause
