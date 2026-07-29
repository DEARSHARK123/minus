Minus Portable (blank / fresh install)
======================================

This zip is self-contained. Recipients only need this folder (or the zip).
They do NOT need the source repo, npm, or npm run dev.

How to start
------------
1. Unzip the whole archive to any folder (keep the structure).
2. Double-click:  Start-Minus.vbs   (recommended, no black console)
   or:            Start-Minus.bat   (shows status text)
3. Browser opens http://127.0.0.1:__PORT__/chat after a few seconds.
4. To stop:       Stop-Minus.bat

Blank state
-----------
- Fresh userdata\ (no chat / course / learning history shipped)
- Server data:   userdata\data\
- Workspace:     userdata\workspace\
- Browser may still show old chats on a PC that used localhost:__PORT__ before;
  use InPrivate/Incognito to verify a blank UI.

API keys
--------
- No secrets are bundled by default.
- Edit app\.env or use Settings inside the app.
- Do not publish a zip that contains real API keys.

Requirements
------------
- Windows 10/11
- This package includes runtime\node\ (Node bundled). No separate install needed.
- If runtime\node is missing, install Node.js LTS from https://nodejs.org/

What is inside (complete package)
---------------------------------
  Start-Minus.vbs / Start-Minus.bat / Stop-Minus.bat / README.txt
  app\          Next.js standalone server + public assets + skills
  runtime\node\ Portable Node.js
  userdata\     Empty data dir (created on first run)

Do NOT send separately: source code, node_modules of the repo, .env.local, ~/.minus

Packaged: __STAMP__

--------------------------------------
Chinese summary
--------------------------------------
1. Only send this one zip (or the unzipped Minus-Portable folder). It is complete.
2. Double-click Start-Minus.vbs to start; Stop-Minus.bat to stop.
3. No source repo needed. No npm run dev.
4. userdata is empty (no history). API keys are not included by default.
5. Launcher names are English-only so zip tools will not garble filenames.
