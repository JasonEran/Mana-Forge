@echo off
REM run_node_server.bat
REM Starts the node-bot server.
REM Runtime configuration is loaded from the repository-root .env by the
REM shared Node config module. Calling-process environment variables override
REM that file; Llama and Whisper paths are auto-discovered under tools\.

cd /d "%~dp0"

REM Keep the backend in this foreground process so Ctrl+C triggers supervised
REM process-tree cleanup and port verification.
call npm start -- %*
exit /b %ERRORLEVEL%
